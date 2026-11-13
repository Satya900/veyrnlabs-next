import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { markGupshupRead } from "../src/lib/crm/whatsapp-gupshup.ts";
import { acknowledgeMessage, markWhatsAppReadTyping, sendConfig } from "../src/lib/crm/whatsapp-send.ts";

const APP_ID = "1b73dad6-1234-5678-9abc-60981da19f70";
const WAMID = "wamid.HBgMOTE5NjkyMTczMDA0FQIAEhgUM0E=";
const recorder = (status = 202) => {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status });
  };
  return { calls, request };
};

test("Gupshup blue ticks: PUT to the app's read endpoint with the API key", async () => {
  const { calls, request } = recorder();
  assert.equal(await markGupshupRead("key-123", APP_ID, WAMID, request), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.gupshup.io/wa/app/${APP_ID}/msg/${encodeURIComponent(WAMID)}/read`);
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.headers.apikey, "key-123");
  // No App ID (not added in Settings yet), a bad message id or a failure: nothing breaks.
  assert.equal(await markGupshupRead("key-123", "", WAMID, request), false);
  assert.equal(await markGupshupRead("key-123", APP_ID, "bad id", request), false);
  assert.equal(calls.length, 1);
  assert.equal(await markGupshupRead("key-123", APP_ID, WAMID, recorder(401).request), false);
  assert.equal(await markGupshupRead("key-123", APP_ID, WAMID, async () => { throw new Error("timeout"); }), false);
});

test("Meta: one call marks read and shows typing", async () => {
  const { calls, request } = recorder(200);
  assert.equal(await markWhatsAppReadTyping("tok", "1234567890", WAMID, request), true);
  assert.equal(calls[0].url, "https://graph.facebook.com/v25.0/1234567890/messages");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    messaging_product: "whatsapp",
    status: "read",
    message_id: WAMID,
    typing_indicator: { type: "text" },
  });
});

test("acknowledgeMessage picks the provider; sendConfig carries a valid App ID only", async () => {
  const env = {
    WHATSAPP_SEND_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: "key-123",
    WHATSAPP_SEND_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000001",
    WHATSAPP_SEND_PHONE_ID: "919000000000",
    WHATSAPP_SEND_WABA_ID: "0",
    WHATSAPP_REPLY_COST_PAISE: "50",
    WHATSAPP_SEND_PROVIDER: "gupshup",
    WHATSAPP_SEND_APP: "SunriseRealty",
  };
  assert.equal(sendConfig({ ...env, WHATSAPP_SEND_APP_ID: APP_ID }).appId, APP_ID);
  assert.equal(sendConfig({ ...env, WHATSAPP_SEND_APP_ID: "not-an-id" }).appId, "");
  const gupshup = recorder();
  await acknowledgeMessage(sendConfig({ ...env, WHATSAPP_SEND_APP_ID: APP_ID }), WAMID, gupshup.request);
  assert.match(gupshup.calls[0].url, /api\.gupshup\.io\/wa\/app\/.+\/read$/);
  const meta = recorder(200);
  await acknowledgeMessage(sendConfig({ ...env, WHATSAPP_SEND_PROVIDER: "meta" }), WAMID, meta.request);
  assert.match(meta.calls[0].url, /graph\.facebook\.com/);
});

test("members can read the App ID column but still not the callback token", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  await db.exec("set role authenticated");
  await db.query("select provider_app_id from crm_whatsapp_connections");
  await assert.rejects(db.query("select callback_token from crm_whatsapp_connections"), /permission denied/);
});
