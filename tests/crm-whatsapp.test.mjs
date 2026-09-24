import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { whatsappReceiverConfigured } from "../src/lib/crm/whatsapp-config.ts";
import {
  verifyWhatsAppSignature,
  verifyWhatsAppChallenge,
  parseWhatsAppMessages,
  readWebhookBody,
} from "../src/lib/crm/whatsapp-webhook.ts";

const payload = (messages, overrides = {}) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "111",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "222" },
            messages,
            contacts: [{ wa_id: "919111111111", profile: { name: "Buyer" } }],
            ...overrides,
          },
        },
      ],
    },
  ],
});
const message = (id = "wamid.test") => ({
  id,
  from: "919111111111",
  timestamp: String(Math.floor(Date.now() / 1000)),
  type: "text",
  text: { body: "Looking for a 2 BHK" },
});

test("receiver readiness fails closed unless explicitly enabled with every required server value", () => {
  const configured = {
    WHATSAPP_WEBHOOK_ENABLED: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    WHATSAPP_APP_SECRET: "test-secret",
    WHATSAPP_VERIFY_TOKEN: "test-token",
  };
  assert.equal(whatsappReceiverConfigured(configured), true);
  for (const key of Object.keys(configured)) {
    assert.equal(
      whatsappReceiverConfigured({ ...configured, [key]: "" }),
      false,
    );
    assert.equal(
      whatsappReceiverConfigured({ ...configured, [key]: "   " }),
      false,
    );
  }
  assert.equal(
    whatsappReceiverConfigured({
      ...configured,
      WHATSAPP_WEBHOOK_ENABLED: "false",
    }),
    false,
  );
  assert.equal(whatsappReceiverConfigured({}), false);
});

test("WhatsApp verification authenticates exact bytes and rejects forged or missing signatures", () => {
  const body = Buffer.from(JSON.stringify(payload([message()])));
  const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
  assert.equal(verifyWhatsAppSignature(body, signature, "app-secret"), true);
  assert.equal(
    verifyWhatsAppSignature(
      Buffer.concat([body, Buffer.from(" ")]),
      signature,
      "app-secret",
    ),
    false,
  );
  assert.equal(verifyWhatsAppSignature(body, signature, "wrong"), false);
  for (const value of [null, "sha256=bad", "", `sha256=${"0".repeat(64)}`])
    assert.equal(verifyWhatsAppSignature(body, value, "app-secret"), false);
  const url = new URL(
    "https://crm.example/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-token&hub.challenge=12345",
  );
  assert.equal(verifyWhatsAppChallenge(url, "test-token"), "12345");
  assert.equal(verifyWhatsAppChallenge(url, "wrong"), null);
  assert.equal(verifyWhatsAppChallenge(url, ""), null);
  url.searchParams.set("hub.challenge", "<script>");
  assert.equal(verifyWhatsAppChallenge(url, "test-token"), null);
});

test("webhook reader bounds streamed bodies before processing", async () => {
  const request = () =>
    new Request("https://crm.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "123456",
    });
  await assert.rejects(readWebhookBody(request(), 5), /too large/);
  assert.equal((await readWebhookBody(request(), 6)).toString(), "123456");
});

test("normalization handles batches, contact matching and non-text messages without fetching media", () => {
  const input = payload([
    message(),
    {
      ...message("wamid.image"),
      type: "image",
      image: { id: "untrusted-media", caption: "Floor plan" },
    },
  ]);
  input.entry.push({ ...input.entry[0], id: "333" });
  const normalized = parseWhatsAppMessages(input);
  assert.equal(normalized.length, 4);
  assert.equal(normalized[0].contact_name, "Buyer");
  assert.equal(normalized[1].body, "Floor plan");
  assert.equal(normalized[2].waba_id, "333");
  assert.equal(normalized[0].organization_id, undefined);
  assert.deepEqual(
    parseWhatsAppMessages(
      payload(undefined, {
        statuses: [{ id: "wamid.status", status: "delivered" }],
      }),
    ),
    [],
  );
  assert.equal(
    parseWhatsAppMessages(
      payload([message()], {
        contacts: [{ wa_id: "999999", profile: { name: "Wrong contact" } }],
      }),
    )[0].contact_name,
    "",
  );
  assert.throws(() =>
    parseWhatsAppMessages(payload([{ ...message(), from: "invalid" }])),
  );
  assert.throws(() =>
    parseWhatsAppMessages(payload([{ ...message(), text: {} }])),
  );
  assert.throws(() => parseWhatsAppMessages({ object: "page", entry: [] }));
});

test("WhatsApp storage deduplicates leads and isolates inbox access", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  for (const file of [
    "202609140001_crm",
    "202609150001_crm_saved_views",
    "202609150002_crm_capture_returns_inserted",
    "202609220001_crm_organizations",
    "202609230001_crm_invitations",
    "202609230002_crm_usage_budgets",
    "202609230003_crm_whatsapp_inbox",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}.sql`, import.meta.url),
        "utf8",
      ),
    );
  const ownerA = crypto.randomUUID(),
    ownerB = crypto.randomUUID(),
    team = crypto.randomUUID();
  for (const id of [ownerA, ownerB, team])
    await db.query("insert into auth.users values($1,$2,now())", [
      id,
      `${id}@example.com`,
    ]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await login("", "service_role");
  const provision = async (id) =>
    (
      await db.query(
        "select crm_provision_organization($1,'Company','Owner') as id",
        [id],
      )
    ).rows[0].id;
  const a = await provision(ownerA),
    b = await provision(ownerB);
  await db.query(
    "insert into crm_members(id,name,role,organization_id) values($1,'Agent','team',$2)",
    [team, a],
  );
  await db.query(
    "insert into crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active) values($1,'111','222','+91 9000000000',true),($2,'333','444','+91 9000000001',true)",
    [a, b],
  );
  const receive = async (events) =>
    (
      await db.query("select crm_receive_whatsapp($1::jsonb) as result", [
        JSON.stringify(events),
      ])
    ).rows[0].result;
  const first = parseWhatsAppMessages(payload([message()]))[0];
  await t.test(
    "one contact creates one lead; retries and out-of-order events are safe",
    async () => {
      assert.equal((await receive([first])).inserted, 1);
      assert.equal((await receive([first])).inserted, 0);
      await receive([
        {
          ...first,
          message_id: "wamid.older",
          sent_at: "2025-01-01T00:00:00.000Z",
          contact_name: "Old name",
        },
      ]);
      assert.equal(
        (
          await db.query("select * from crm_leads where organization_id=$1", [
            a,
          ])
        ).rows.length,
        1,
      );
      const conversation = (
        await db.query(
          "select * from crm_whatsapp_conversations where organization_id=$1",
          [a],
        )
      ).rows[0];
      assert.equal(
        new Date(conversation.last_message_at).toISOString(),
        first.sent_at,
      );
      assert.equal(conversation.contact_name, "Buyer");
    },
  );
  const convo = (
    await db.query(
      "select * from crm_whatsapp_conversations where organization_id=$1",
      [a],
    )
  ).rows[0];
  await t.test(
    "WABA and phone mapping must both match; unknown mappings cannot select a tenant",
    async () => {
      assert.equal(
        (
          await receive([
            {
              ...first,
              message_id: "wrong-waba",
              waba_id: "333",
              organization_id: b,
            },
          ])
        ).ignored,
        1,
      );
      assert.equal(
        (
          await receive([
            { ...first, message_id: "unknown-phone", phone_number_id: "999" },
          ])
        ).ignored,
        1,
      );
      await receive([{ ...first, waba_id: "333", phone_number_id: "444" }]);
      assert.equal(
        (
          await db.query("select * from crm_leads where organization_id=$1", [
            b,
          ])
        ).rows.length,
        1,
      );
    },
  );
  await t.test(
    "a failed batch rolls back all new leads and messages",
    async () => {
      await assert.rejects(
        receive([
          { ...first, message_id: "new-before-bad", sender: "919222222222" },
          { ...first, message_id: "zz-bad", sender: "invalid" },
        ]),
      );
      assert.equal(
        (
          await db.query(
            "select * from crm_whatsapp_messages where message_id='new-before-bad'",
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from crm_leads where phone='919222222222'"))
          .rows.length,
        0,
      );
    },
  );
  await t.test(
    "RLS protects conversation history and mappings from other tenants and unassigned users",
    async () => {
      await login(ownerA);
      assert.equal(
        (await db.query("select * from crm_whatsapp_conversations")).rows
          .length,
        1,
      );
      assert.equal(
        (await db.query("select * from crm_whatsapp_messages")).rows.length,
        2,
      );
      assert.equal(
        (await db.query("select * from crm_whatsapp_connections")).rows.length,
        1,
      );
      await assert.rejects(receive([first]), /permission denied/);
      await assert.rejects(
        db.query("update crm_whatsapp_connections set active=false"),
        /permission denied/,
      );
      await login(ownerB);
      assert.equal(
        (
          await db.query(
            "select * from crm_whatsapp_messages where conversation_id=$1",
            [convo.id],
          )
        ).rows.length,
        0,
      );
      await login(team);
      assert.equal(
        (await db.query("select * from crm_whatsapp_messages")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from crm_whatsapp_connections")).rows.length,
        0,
      );
      await login("", "service_role");
      await db.query("update crm_leads set owner_id=$1 where id=$2", [
        team,
        convo.lead_id,
      ]);
      await login(team);
      assert.equal(
        (await db.query("select * from crm_whatsapp_messages")).rows.length,
        2,
      );
      await login("", "anon");
      await assert.rejects(
        db.query("select * from crm_whatsapp_messages"),
        /permission denied/,
      );
      await login("", "service_role");
    },
  );
  await t.test(
    "paused connections ignore incoming messages and never spend outbound allowance",
    async () => {
      await db.query(
        "update crm_whatsapp_connections set active=false where organization_id=$1",
        [a],
      );
      assert.equal(
        (await receive([{ ...first, message_id: "paused" }])).ignored,
        1,
      );
      assert.equal(
        (await db.query("select * from crm_usage_events")).rows.length,
        0,
      );
    },
  );
});
