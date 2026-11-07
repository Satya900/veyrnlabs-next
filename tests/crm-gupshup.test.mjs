import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseGupshupCallback, sendGupshupText } from "../src/lib/crm/whatsapp-gupshup.ts";
import { sendConfig, sendReply } from "../src/lib/crm/whatsapp-send.ts";

test("sendGupshupText posts the documented form and classifies outcomes", async () => {
  let seen;
  const ok = await sendGupshupText("key-123", "VeyrnRealty", "919800000001", "919800000002", "Hello", async (url, init) => {
    seen = { url, init };
    return Response.json({ status: "submitted", messageId: "gs-1" }, { status: 202 });
  });
  assert.deepEqual(ok, { status: "accepted", messageId: "gs-1" });
  assert.equal(seen.url, "https://api.gupshup.io/wa/api/v1/msg");
  assert.equal(seen.init.headers.apikey, "key-123");
  const form = new URLSearchParams(seen.init.body.toString());
  assert.equal(form.get("channel"), "whatsapp");
  assert.equal(form.get("source"), "919800000001");
  assert.equal(form.get("destination"), "919800000002");
  assert.equal(form.get("src.name"), "VeyrnRealty");
  assert.deepEqual(JSON.parse(form.get("message")), { type: "text", text: "Hello" });

  const rejected = await sendGupshupText("bad", "VeyrnRealty", "919800000001", "919800000002", "Hi", async () =>
    Response.json({ status: "error", message: "Authentication Failed" }, { status: 401 }));
  assert.deepEqual(rejected, { status: "rejected", messageId: null });
  // Anything ambiguous is "unknown" so nothing retries automatically.
  for (const respond of [
    async () => Response.json({}, { status: 502 }),
    async () => { throw new Error("timeout"); },
    async () => Response.json({ status: "submitted" }),
  ])
    assert.equal((await sendGupshupText("k", "App", "919800000001", "919800000002", "Hi", respond)).status, "unknown");
  await assert.rejects(sendGupshupText("k", "bad app!", "919800000001", "919800000002", "Hi"), /Invalid reply/);
});

test("sendReply routes Gupshup connections through Gupshup", async () => {
  const send = sendConfig({
    WHATSAPP_SEND_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: "key-123",
    WHATSAPP_SEND_ORGANIZATION_ID: crypto.randomUUID(),
    WHATSAPP_SEND_PHONE_ID: "919800000001",
    WHATSAPP_SEND_WABA_ID: "0",
    WHATSAPP_REPLY_COST_PAISE: "12",
    WHATSAPP_SEND_PROVIDER: "gupshup",
    WHATSAPP_SEND_APP: "VeyrnRealty",
  });
  assert.equal(send.provider, "gupshup");
  let url;
  await sendReply(send, send.phone, "919800000002", "Hi", async (u) => {
    url = u;
    return Response.json({ status: "submitted", messageId: "gs-2" });
  });
  assert.equal(url, "https://api.gupshup.io/wa/api/v1/msg");
  // A Gupshup connection without an app name can't send.
  assert.equal(sendConfig({ WHATSAPP_SEND_PROVIDER: "gupshup", WHATSAPP_SEND_APP: "" }), null);
});

test("parseGupshupCallback converts messages and delivery events", () => {
  const phone = "919800000001";
  const text = parseGupshupCallback({
    app: "VeyrnRealty", timestamp: 1718007189549, version: 2, type: "message",
    payload: { id: "wamid.1", source: "919811111111", type: "text", payload: { text: "Is the 2BHK available?" },
      sender: { phone: "919811111111", name: "Priya", country_code: "91", dial_code: "9811111111" } },
  }, phone);
  assert.deepEqual(text.events[0], {
    waba_id: "0", phone_number_id: phone, message_id: "wamid.1", sender: "919811111111",
    contact_name: "Priya", message_type: "text", body: "Is the 2BHK available?",
    sent_at: new Date(1718007189549).toISOString(),
  });
  const button = parseGupshupCallback({ type: "message", timestamp: 1, payload: { id: "wamid.2", type: "button_reply",
    payload: { title: "Book a visit" }, sender: { phone: "919811111111" } } }, phone);
  assert.equal(button.events[0].body, "Book a visit");

  const delivered = parseGupshupCallback({ type: "message-event", payload: { id: "wamid.out", gsId: "gs-1", type: "delivered",
    destination: "919811111111", payload: { ts: 1718007200 } } }, phone);
  assert.deepEqual(delivered.receipts[0], {
    waba_id: "0", phone_number_id: phone, message_id: "gs-1", recipient: "919811111111", status: "delivered",
    occurred_at: new Date(1718007200 * 1000).toISOString(), error_code: null,
  });
  const failed = parseGupshupCallback({ type: "message-event", payload: { id: "gs-9", type: "failed",
    destination: "919811111111", payload: { code: 1002, reason: "Number does not exist" } } }, phone);
  assert.equal(failed.receipts[0].message_id, "gs-9");
  assert.equal(failed.receipts[0].error_code, 1002);

  for (const ignored of [
    { type: "message-event", payload: { id: "gs-1", type: "enqueued", destination: "919811111111" } },
    { type: "user-event", payload: { type: "opted-in", phone: "919811111111" } },
    { type: "platform-event", payload: { type: "connectivity-check" } },
  ])
    assert.deepEqual(parseGupshupCallback(ignored, phone), { events: [], receipts: [] });
  assert.throws(() => parseGupshupCallback({ type: "message", payload: { id: "x", type: "text", payload: { text: "" }, sender: { phone: "919811111111" } } }, phone));
  assert.throws(() => parseGupshupCallback({ type: "message", payload: { id: "x", type: "text", payload: { text: "hi" }, sender: { phone: "not-a-number" } } }, phone));
});

test("Gupshup connections store inbound messages and keep the callback token private", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const [owner, agent] = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of [owner, agent]) await db.query("insert into auth.users values($1,$2,now())", [id, id + "@test.invalid"]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await login("", "service_role");
  const org = (await db.query("select crm_provision_organization($1,'Agency','Owner') id", [owner])).rows[0].id;
  await db.query("insert into crm_subscriptions(organization_id,plan,billing_months,active) values($1,'pro_plus',1,true)", [org]);
  await db.query("insert into crm_members(id,organization_id,name,role) values($1,$2,'Agent','team')", [agent, org]);
  const token = "a".repeat(64);
  const save = (actor, phone, t = token) =>
    db.query("select crm_save_gupshup_connection($1,'VeyrnRealty',$2,$3,'encrypted',$4)", [actor, phone, "+" + phone, t]);

  await assert.rejects(save(agent, "919800000001"), /Only the owner/);
  await assert.rejects(save(owner, "12ab"), /country code/);
  await save(owner, "919800000001");
  const connection = (await db.query("select provider,provider_app,waba_id,phone_number_id,active from crm_whatsapp_connections where organization_id=$1", [org])).rows[0];
  assert.deepEqual(connection, { provider: "gupshup", provider_app: "VeyrnRealty", waba_id: "0", phone_number_id: "919800000001", active: true });
  // A different, still-connected number can't silently replace it; after disconnecting it can.
  await assert.rejects(save(owner, "919800000009", "b".repeat(64)), /different number/);

  // Inbound message through the existing ingestion function creates a lead and conversation.
  const inbound = parseGupshupCallback({ type: "message", timestamp: Date.now(), payload: { id: "wamid.10", type: "text",
    payload: { text: "Hi, I saw your listing" }, sender: { phone: "919811111111", name: "Priya" } } }, "919800000001");
  await db.query("select crm_receive_whatsapp($1)", [JSON.stringify(inbound.events)]);
  const conversation = (await db.query("select c.sender, l.name from crm_whatsapp_conversations c join crm_leads l on l.id=c.lead_id where c.organization_id=$1", [org])).rows[0];
  assert.deepEqual(conversation, { sender: "919811111111", name: "Priya" });
  const receipts = parseGupshupCallback({ type: "message-event", payload: { gsId: "gs-1", type: "read",
    destination: "919811111111", payload: { ts: Math.floor(Date.now() / 1000) } } }, "919800000001").receipts;
  await db.query("select crm_receive_whatsapp_receipts($1)", [JSON.stringify(receipts)]);
  assert.equal((await db.query("select status from crm_whatsapp_receipts where message_id='gs-1'")).rows[0].status, "read");

  // Members can see the connection but never its callback token.
  await login(owner);
  assert.equal((await db.query("select provider from crm_whatsapp_connections")).rows[0].provider, "gupshup");
  await assert.rejects(db.query("select callback_token from crm_whatsapp_connections"), /permission denied/);

  await db.query("select crm_disconnect_whatsapp()");
  await login("", "service_role");
  await save(owner, "919800000009", "b".repeat(64));
  assert.equal((await db.query("select phone_number_id from crm_whatsapp_connections where organization_id=$1", [org])).rows[0].phone_number_id, "919800000009");
});
