import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const grant = (db, org, plan, starts, ends, ai = 3000) =>
  db.query(
    "select crm_admin_grant_plan($1,$2,$3::timestamptz,$4::timestamptz,$5,10000,1000,'admin@veyrn.test','pilot') g",
    [org, plan, starts, ends, ai],
  );

test("the platform admin can grant any plan for a period, extend it and revoke it", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const owner = crypto.randomUUID();
  await db.query("insert into auth.users values($1,'owner@gift.test',now())", [owner]);
  await db.exec("set role service_role");
  const org = (await db.query("select crm_provision_organization($1,'Gift Realty','Asha') id", [owner])).rows[0].id;

  // 100 days of Pro Plus from now: four monthly periods with the chosen AI allowance.
  const g = (await grant(db, org, "pro_plus", null, new Date(Date.now() + 100 * 86400e3).toISOString(), 5000)).rows[0].g;
  assert.equal(g.months, 4); // the last one is a short slice
  assert.equal(g.granted_by, "admin@veyrn.test");
  const periods = (await db.query("select ai_limit,revenue_paise,whatsapp_limit from crm_usage_periods where grant_id=$1 order by starts_at", [g.id])).rows;
  assert.equal(periods.length, 4);
  assert.deepEqual(periods[0], { ai_limit: 5000, revenue_paise: 69900, whatsapp_limit: 1000 });
  assert.equal((await db.query("select plan,active from crm_subscriptions where organization_id=$1", [org])).rows[0].plan, "pro_plus");

  // The workspace owner now sees an active Pro Plus plan.
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("set role authenticated");
  assert.deepEqual((await db.query("select crm_plan_tier() t")).rows[0].t, { plan: "pro_plus", active: true });
  await assert.rejects(grant(db, org, "pro", null, "2030-01-01"), /permission denied/);
  await db.exec("reset role");
  await db.exec("set role service_role");

  // Overlaps and plan switches are refused; extending after the end works.
  await assert.rejects(grant(db, org, "pro_plus", null, new Date(Date.now() + 10 * 86400e3).toISOString()), /already has a plan until/);
  await assert.rejects(grant(db, org, "pro", g.ends_at, new Date(Date.parse(g.ends_at) + 30 * 86400e3).toISOString()), /on Pro Plus right now/);
  await assert.rejects(grant(db, org, "pro_plus", null, new Date(Date.now() + 4 * 365 * 86400e3).toISOString()), /at most 3 years/);
  const next = (await grant(db, org, "pro_plus", g.ends_at, new Date(Date.parse(g.ends_at) + 28 * 86400e3).toISOString())).rows[0].g;
  assert.equal(next.months, 1);

  // Granted access isn't counted as paying, but the overview lists the grants.
  let row = (await db.query("select crm_platform_overview() o")).rows[0].o.workspaces.find((w) => w.id === org);
  assert.equal(row.paying, false);
  assert.equal(row.grants.length, 2);
  assert.equal(row.grants[0].plan, "pro_plus");

  // Revoking ends access now and drops the future months; the later grant is untouched.
  await db.query("insert into crm_usage_events(organization_id,period_id,event_key,kind,units,reserved_paise) select organization_id,id,'spent','ai',1,5 from crm_usage_periods where grant_id=$1 and starts_at<=now() and ends_at>now()", [g.id]);
  const revoked = (await db.query("select crm_admin_revoke_grant($1,'admin@veyrn.test') r", [g.id])).rows[0].r;
  assert.ok(revoked.revoked_at);
  assert.equal((await db.query("select count(*)::int n from crm_usage_periods where grant_id=$1", [g.id])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from crm_usage_periods where organization_id=$1 and starts_at<=now() and ends_at>now()", [org])).rows[0].n, 0);
  row = (await db.query("select crm_platform_overview() o")).rows[0].o.workspaces.find((w) => w.id === org);
  assert.deepEqual(row.grants.map((x) => x.id), [next.id]);

  // With nothing live any more, a different plan can be granted from now.
  await db.query("select crm_admin_revoke_grant($1,'admin@veyrn.test')", [next.id]);
  const pro = (await grant(db, org, "pro", null, new Date(Date.now() + 14 * 86400e3).toISOString(), 1000)).rows[0].g;
  assert.equal(pro.plan, "pro");
  assert.equal((await db.query("select plan from crm_subscriptions where organization_id=$1", [org])).rows[0].plan, "pro");
});
