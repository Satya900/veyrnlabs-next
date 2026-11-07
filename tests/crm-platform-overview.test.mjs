import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("the platform overview totals every workspace and is server-only", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
  await db.query("insert into auth.users values($1,'owner@paying.test',now()),($2,'owner@free.test',now())", [a, b]);
  await db.exec("set role service_role");
  const paying = (await db.query("select crm_provision_organization($1,'Paying Realty','Asha') id", [a])).rows[0].id;
  const free = (await db.query("select crm_provision_organization($1,'Free Realty','Bala') id", [b])).rows[0].id;
  await db.query("insert into crm_subscriptions(organization_id,plan,billing_months,active) values($1,'pro',3,true)", [paying]);
  await db.query("insert into crm_usage_periods(organization_id,starts_at,ends_at,revenue_paise,overhead_paise,ai_limit,whatsapp_limit) values($1,now()-interval '1 day',now()+interval '29 days',44900,10000,10,10)", [paying]);
  await db.query("insert into crm_billing_subscriptions(organization_id,razorpay_subscription_id,razorpay_plan_id,plan,billing_months,status,amount_paise) values($1,'sub_1','plan_1','pro',3,'active',134700)", [paying]);
  await db.query("select crm_save_gupshup_connection($1,'app','916372506476','+916372506476','enc',$2)", [a, "d".repeat(64)]);
  const stage = (await db.query("select id from crm_stages where organization_id=$1 limit 1", [paying])).rows[0].id;
  for (const name of ["One", "Two", "Three"])
    await db.query("insert into crm_leads(organization_id,name,stage_id) values($1,$2,$3)", [paying, name, stage]);

  const overview = (await db.query("select crm_platform_overview() o")).rows[0].o;
  assert.equal(overview.totals.workspaces >= 2, true);
  assert.equal(overview.totals.paying, 1);
  assert.equal(overview.totals.mrr_paise, 44900); // ₹1,347 per quarter = ₹449 a month
  assert.equal(overview.totals.whatsapp_connected, 1);
  const row = overview.workspaces.find((w) => w.id === paying);
  assert.equal(row.owner_email, "owner@paying.test");
  assert.equal(row.owner_name, "Asha");
  assert.equal(row.paying, true);
  assert.equal(row.leads, 3);
  assert.equal(row.leads_7d, 3);
  assert.equal(row.whatsapp_provider, "gupshup");
  assert.equal(row.billing_status, "active");
  const freeRow = overview.workspaces.find((w) => w.id === free);
  assert.equal(freeRow.paying, false);
  assert.equal(freeRow.monthly_paise, 0);
  assert.ok(Array.isArray(overview.health.workers));

  // Customers can never read the cross-workspace overview.
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
  await db.exec("set role authenticated");
  await assert.rejects(db.query("select crm_platform_overview()"), /permission denied/);
});
