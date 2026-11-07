import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { CRM_PLANS, EXTRA_SEAT_PAISE, planPrice } from "../src/lib/crm/plans.ts";

const PRICE_CARD = "202610280001_crm_price_card.sql";

test("the database price card matches the app's price table", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    await readFile(new URL("../supabase/migrations/" + PRICE_CARD, import.meta.url), "utf8")
      .then((sql) => sql.slice(sql.indexOf("create function"), sql.indexOf("revoke all"))),
  );
  for (const plan of Object.keys(CRM_PLANS))
    for (const months of [1, 3, 12])
      assert.equal(
        Number((await db.query("select public.crm_plan_monthly_paise($1,$2) p", [plan, months])).rows[0].p),
        planPrice(plan, months).monthlyPaise,
      );
  assert.equal(
    Number((await db.query("select public.crm_seat_monthly_paise() p")).rows[0].p),
    EXTRA_SEAT_PAISE,
  );
});

test("subscriptions sold at the old price keep renewing at that price", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  const files = (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const run = async (file) =>
    db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  for (const file of files.filter((f) => f < PRICE_CARD)) await run(file);

  const owners = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of owners)
    await db.query("insert into auth.users values($1,$2,now())", [id, id + "@test.invalid"]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  const checkout = async (owner, sub) => {
    await login(owner);
    const attempt = (await db.query("select crm_begin_checkout('base','pro',1,1) j")).rows[0].j;
    await login("", "service_role");
    await db.query("select crm_finish_checkout($1,$2,$3)", [attempt.id, sub, "plan_" + sub]);
  };
  let n = 0;
  const pay = (sub, amount) =>
    db.query(
      "select crm_apply_paid_event($1,$2,$3,'active',now(),$4,now()-interval '1 day',now()-interval '1 day'+interval '1 month',$5,'INR',20000,100,50)",
      [createHash("sha256").update(String(++n)).digest("hex"), sub, "plan_" + sub, "pay_" + n, amount],
    );

  await login("", "service_role");
  for (const [i, owner] of owners.entries())
    await db.query("select crm_provision_organization($1,$2,'Owner')", [owner, "Agency " + i]);
  await checkout(owners[0], "legacy");
  await db.exec("reset role");
  for (const file of files.filter((f) => f >= PRICE_CARD)) await run(file);
  await checkout(owners[1], "current");

  await assert.rejects(pay("legacy", 49900), /amount mismatch/);
  await pay("legacy", 400000);
  await assert.rejects(pay("current", 400000), /amount mismatch/);
  await pay("current", 49900);
  // Overhead must stay under 70% of the new, much lower monthly revenue.
  await assert.rejects(
    db.query(
      "select crm_apply_paid_event($1,'current','plan_current','active',now(),'pay_overhead',now()+interval '1 month',now()+interval '2 months',49900,'INR',40000,100,50)",
      [createHash("sha256").update("overhead").digest("hex")],
    ),
    /Invalid allowances/,
  );
});

test("a workspace's first paid month gets the AI bonus; renewals and prepaid months don't", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const owners = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of owners) await db.query("insert into auth.users values($1,$2,now())", [id, id + "@test.invalid"]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await login("", "service_role");
  const orgs = [];
  for (const [i, owner] of owners.entries())
    orgs.push((await db.query("select crm_provision_organization($1,$2,'Owner') id", [owner, "Agency " + i])).rows[0].id);
  const checkout = async (owner, sub, months) => {
    await login(owner);
    const attempt = (await db.query("select crm_begin_checkout('base','pro',$1,1) j", [months])).rows[0].j;
    await login("", "service_role");
    await db.query("select crm_finish_checkout($1,$2,$3)", [attempt.id, sub, "plan_" + sub]);
  };
  let n = 0;
  const pay = (sub, months, amount, startOffset) =>
    db.query(
      `select crm_apply_paid_event($1,$2,$3,'active',now(),$4,now()+interval '${startOffset}',now()+interval '${startOffset}'+make_interval(months=>$5),$6,'INR',20000,1000,50,2500)`,
      [createHash("sha256").update("bonus" + ++n).digest("hex"), sub, "plan_" + sub, "pay_b" + n, months, amount],
    );
  const limits = async (org) =>
    (await db.query("select ai_limit from crm_usage_periods where organization_id=$1 and trial_budget_paise is null order by starts_at", [org])).rows.map((r) => r.ai_limit);

  // Monthly: first month 2,500, the renewal 1,000.
  await checkout(owners[0], "monthly", 1);
  await pay("monthly", 1, 49900, "-1 day");
  await pay("monthly", 1, 49900, "-1 day +1 month");
  assert.deepEqual(await limits(orgs[0]), [2500, 1000]);
  // Quarterly prepay: only the first of the three months gets the bonus.
  await checkout(owners[1], "quarterly", 3);
  await pay("quarterly", 3, 44900 * 3, "-1 day");
  assert.deepEqual(await limits(orgs[1]), [2500, 1000, 1000]);
});
