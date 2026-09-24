import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { sendConfig, sendWhatsAppReply } from "../src/lib/crm/whatsapp-send.ts";
import { parseWhatsAppReceipts } from "../src/lib/crm/whatsapp-webhook.ts";
import { deliveryLabel } from "../src/lib/crm/delivery.ts";

test("receipt parser bounds signed events and handles status-only payloads", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "111",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "222" },
              statuses: [
                {
                  id: "wamid.test",
                  recipient_id: "919111111111",
                  status: "failed",
                  timestamp: "1750000000",
                  errors: [
                    { code: 131047, title: "Do not expose provider text" },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const [receipt] = parseWhatsAppReceipts(payload);
  assert.equal(receipt.error_code, 131047);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.message_id, "wamid.test");
  assert.equal(receipt.title, undefined);
  assert.match(
    deliveryLabel({ status: "accepted", delivery_status: "read" }),
    /Read/,
  );
  payload.entry[0].changes[0].value.statuses[0].timestamp = "invalid";
  assert.throws(() => parseWhatsAppReceipts(payload));
  assert.throws(() => parseWhatsAppReceipts({ object: "other", entry: [] }));
});

test("outbound requires explicit scoped configuration and never retries ambiguous sends", async () => {
  const env = {
    WHATSAPP_SEND_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: "offline",
    WHATSAPP_SEND_ORGANIZATION_ID: crypto.randomUUID(),
    WHATSAPP_SEND_PHONE_ID: "222",
    WHATSAPP_SEND_WABA_ID: "111",
    WHATSAPP_REPLY_COST_PAISE: "10",
  };
  assert.ok(sendConfig(env));
  for (const key of Object.keys(env))
    assert.equal(sendConfig({ ...env, [key]: "" }), null);
  let calls = 0;
  const result = await sendWhatsAppReply(
    "offline",
    "222",
    "919111111111",
    "Approved text",
    async (url, init) => {
      calls++;
      assert.equal(url, "https://graph.facebook.com/v25.0/222/messages");
      const body = JSON.parse(init.body);
      assert.equal(body.text.body, "Approved text");
      assert.equal(body.to, "919111111111");
      assert.equal(body.type, "text");
      return Response.json({ messages: [{ id: "wamid.test" }] });
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "accepted");
  assert.equal(
    (
      await sendWhatsAppReply("x", "222", "919111111111", "Reply", async () =>
        Response.json({ error: { code: 190 } }, { status: 401 }),
      )
    ).status,
    "rejected",
  );
  for (const response of [
    async () => {
      throw new Error("timeout");
    },
    async () => Response.json({ error: { code: 1 } }, { status: 500 }),
    async () => Response.json({}),
  ])
    assert.equal(
      (await sendWhatsAppReply("x", "222", "919111111111", "Reply", response))
        .status,
      "unknown",
    );
});

test("reviewed sending enforces access, window, budget, scope and replay boundaries", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const f of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + f, import.meta.url),
        "utf8",
      ),
    );
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID(),
    team = crypto.randomUUID();
  for (const id of [owner, other, team])
    await db.query("insert into auth.users values($1,$2,now())", [
      id,
      id + "@example.test",
    ]);
  const org = (
    await db.query("select crm_provision_organization($1,'Test','Owner') id", [
      owner,
    ])
  ).rows[0].id;
  await db.query("select crm_provision_organization($1,'Other','Owner')", [
    other,
  ]);
  await db.query(
    "insert into crm_members(id,name,role,organization_id)values($1,'Agent','team',$2)",
    [team, org],
  );
  await db.query(
    "insert into crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active)values($1,'111','222','Test',true)",
    [org],
  );
  await db.query(
    "insert into crm_ai_settings values($1,'Fictional company information for drafting.',true,now())",
    [org],
  );
  await db.query("select crm_open_ai_trial($1)", [org]);
  let seq = 0;
  async function incoming(body = "Looking for an apartment") {
    await db.query("select crm_receive_whatsapp($1::jsonb)", [
      JSON.stringify([
        {
          waba_id: "111",
          phone_number_id: "222",
          message_id: "msg-" + ++seq,
          sender: "919111111111",
          contact_name: "Test",
          message_type: "text",
          body,
          sent_at: new Date(Date.now() + seq * 1000).toISOString(),
        },
      ]),
    ]);
  }
  await incoming();
  const chat = (
    await db.query(
      "select id from crm_whatsapp_conversations where organization_id=$1",
      [org],
    )
  ).rows[0].id;
  async function draft() {
    const j = (
      await db.query("select crm_start_ai_draft($1,$2,'model',100) j", [
        owner,
        chat,
      ])
    ).rows[0].j;
    await db.query("select crm_finish_ai_draft($1,'Draft',false,'Review',1)", [
      j.id,
    ]);
    return j.id;
  }
  let id = await draft();
  const prepare = (actor = owner, scope = org, phone = "222", cost = 10) =>
    db.query(
      "select crm_prepare_whatsapp_reply($1,$2,'Edited reply',$3,$4,'111',$5) j",
      [actor, id, scope, phone, cost],
    );
  await assert.rejects(prepare(), /AI drafts only/);
  // End the trial, then configure a separately funded fixture period.
  await db.query(
    "update crm_usage_periods set starts_at=now()-interval '8 days',ends_at=now()-interval '1 day' where organization_id=$1",
    [org],
  );
  await db.query(
    "select crm_open_usage_period($1,'pro_plus',1,now(),now()+interval '28 days',100,25,3)",
    [org],
  );
  await assert.rejects(prepare(other), /unavailable/);
  await assert.rejects(prepare(team), /unavailable/);
  await assert.rejects(prepare(owner, crypto.randomUUID()), /not configured/);
  await assert.rejects(prepare(owner, org, "999"), /connection/);
  await assert.rejects(prepare(owner, org, "222", 9999999), /budget/);
  await db.query(
    "update crm_whatsapp_messages set sent_at=now()-interval '25 hours' where conversation_id=$1",
    [chat],
  );
  await assert.rejects(prepare(), /window closed/);
  await incoming();
  await assert.rejects(prepare(), /newer customer/);
  id = await draft();
  const job = (await prepare()).rows[0].j;
  assert.equal(job.run, true);
  const receipt = (status, extras = {}) =>
    db.query("select crm_receive_whatsapp_receipts($1::jsonb)", [
      JSON.stringify([
        {
          waba_id: "111",
          phone_number_id: "222",
          message_id: "wamid.test",
          recipient: "919111111111",
          status,
          occurred_at: new Date().toISOString(),
          error_code: null,
          ...extras,
        },
      ]),
    ]);
  // An early receipt must attach after the sending transaction saves its provider ID.
  await receipt("delivered");
  assert.equal(job.body, "Edited reply");
  assert.equal((await prepare()).rows[0].j.run, false);
  await db.query(
    "select crm_finish_whatsapp_reply($1,'accepted','wamid.test',10)",
    [job.id],
  );
  await db.query(
    "select crm_finish_whatsapp_reply($1,'accepted','wamid.test',10)",
    [job.id],
  );
  assert.equal((await prepare()).rows[0].j.status, "accepted");
  const delivery = async () =>
    (
      await db.query(
        "select delivery_status from crm_whatsapp_outbox where id=$1",
        [job.id],
      )
    ).rows[0].delivery_status;
  assert.equal(await delivery(), "delivered");
  await receipt("sent");
  assert.equal(await delivery(), "delivered");
  await receipt("read", { waba_id: "999" });
  assert.equal(await delivery(), "delivered");
  await receipt("read", { recipient: "919222222222" });
  assert.equal(await delivery(), "delivered");
  await receipt("read");
  await receipt("read");
  await receipt("failed", { error_code: 131047 });
  assert.equal(await delivery(), "read");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from crm_whatsapp_receipts where status='read' and recipient='919111111111'",
      )
    ).rows[0].n,
    1,
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select body from crm_whatsapp_outbox")).rows.length,
    0,
  );
  await assert.rejects(prepare(), /permission denied/);
  await assert.rejects(receipt("sent"), /permission denied/);
  await db.exec("reset role");
  await incoming();
  id = await draft();
  const uncertain = (await prepare()).rows[0].j;
  await db.query("select crm_finish_whatsapp_reply($1,'unknown',null,10)", [
    uncertain.id,
  ]);
  assert.equal((await prepare()).rows[0].j.run, false);
  assert.equal(
    (
      await db.query(
        "select e.status from crm_usage_events e join crm_whatsapp_outbox o on o.usage_event_id=e.id where o.id=$1",
        [uncertain.id],
      )
    ).rows[0].status,
    "reserved",
  );
  await incoming();
  id = await draft();
  const rejected = (await prepare()).rows[0].j;
  await db.query("select crm_finish_whatsapp_reply($1,'rejected',null,0)", [
    rejected.id,
  ]);
  assert.equal(
    (
      await db.query(
        "select e.status from crm_usage_events e join crm_whatsapp_outbox o on o.usage_event_id=e.id where o.id=$1",
        [rejected.id],
      )
    ).rows[0].status,
    "cancelled",
  );
  await incoming("STOP");
  await incoming();
  await assert.rejects(draft(), /paused/);
  // Even an operator unpausing cannot bypass the persistent opt-out send check.
  await db.query(
    "update crm_whatsapp_conversations set ai_paused=false where id=$1",
    [chat],
  );
  id = await draft();
  await assert.rejects(prepare(), /consent review/);
});
