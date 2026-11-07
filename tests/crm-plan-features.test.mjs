import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("AI auto-replies: Pro Plus, or Pro during a 14-day trial", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const owner = crypto.randomUUID();
  await db.query("insert into auth.users values($1,'owner@test.invalid',now())", [owner]);
  await db.exec("set role service_role");
  const org = (await db.query("select crm_provision_organization($1,'Sunrise Realty','Owner') id", [owner])).rows[0].id;
  await db.query(
    "insert into crm_usage_periods(organization_id,starts_at,ends_at,revenue_paise,overhead_paise,ai_limit,whatsapp_limit) values($1,now()-interval '1 day',now()+interval '29 days',49900,10000,1000,100)",
    [org],
  );
  await db.query("insert into crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active) values($1,'111','222','Test',true)", [org]);
  const access = async () => (await db.query("select crm_auto_reply_access($1) a", [org])).rows[0].a;
  const as = async (sql, params = []) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec("reset role");
      await db.exec("set role service_role");
    }
  };
  await as("select crm_save_ai_settings('Fictional company facts for testing purposes.',true)");
  let seq = 0;
  const incoming = () =>
    db.query("select crm_receive_whatsapp($1::jsonb)", [
      JSON.stringify([{ waba_id: "111", phone_number_id: "222", message_id: "m-" + ++seq, sender: "919111111111",
        contact_name: "Test", message_type: "text", body: "Is it available?", sent_at: new Date(Date.now() + seq * 1000).toISOString() }]),
    ]);
  const queued = async () => (await db.query("select count(*)::int n from crm_auto_jobs where status='queued'")).rows[0].n;

  // No plan: not available.
  await assert.rejects(as("select crm_set_auto_replies(true)"), /part of Pro Plus/);

  // Pro: switching on starts the 14-day trial, and replies are queued.
  await db.query("insert into crm_subscriptions(organization_id,plan,billing_months,active) values($1,'pro',1,true)", [org]);
  assert.equal((await access()).can_start_trial, true);
  await as("select crm_set_auto_replies(true)");
  let a = await access();
  assert.deepEqual([a.allowed, a.can_start_trial, Boolean(a.trial_ends_at)], [true, false, true]);
  await incoming();
  assert.equal(await queued(), 1);

  // After 14 days nothing new is queued, and it can't be switched back on.
  await db.exec("reset role");
  await db.query("update crm_ai_settings set auto_trial_started_at=now()-interval '15 days' where organization_id=$1", [org]);
  await db.query("update crm_auto_jobs set status='skipped'");
  await db.exec("set role service_role");
  assert.equal((await access()).allowed, false);
  await incoming();
  assert.equal(await queued(), 0);
  await as("select crm_set_auto_replies(false)");
  await assert.rejects(as("select crm_set_auto_replies(true)"), /part of Pro Plus/);

  // Upgrading to Pro Plus makes it available again.
  await db.query("update crm_subscriptions set plan='pro_plus' where organization_id=$1", [org]);
  await as("select crm_set_auto_replies(true)");
  assert.equal((await access()).allowed, true);
  await incoming();
  assert.equal(await queued(), 1);
  // Customers can't read their own entitlement directly; the server does.
  await assert.rejects(as("select crm_auto_reply_access($1)", [org]), /permission denied/);
});
