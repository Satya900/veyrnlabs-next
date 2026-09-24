import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { planPrice, CRM_PLANS } from "../src/lib/crm/plans.ts";

test("plan prices preserve agreed discounts and seats", () => {
  assert.deepEqual(planPrice("pro", 12), {
    monthlyPaise: 320000,
    totalPaise: 3840000,
  });
  assert.deepEqual(planPrice("pro_plus", 3), {
    monthlyPaise: 540000,
    totalPaise: 1620000,
  });
  assert.equal(CRM_PLANS.pro.includedSeats, 1);
  assert.equal(CRM_PLANS.pro_plus.includedSeats, 3);
  assert.throws(() => planPrice("unknown", 1));
  assert.throws(() => planPrice("pro", 6));
});

test("usage budgets and entitlements enforce server-side boundaries", async (t) => {
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
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}.sql`, import.meta.url),
        "utf8",
      ),
    );
  const ownerA = crypto.randomUUID(),
    ownerB = crypto.randomUUID(),
    teammate = crypto.randomUUID();
  for (const id of [ownerA, ownerB, teammate])
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
  const open = async (
    org,
    plan = "pro",
    months = 1,
    overhead = 10000,
    allowance = 10,
  ) =>
    (
      await db.query(
        `select crm_open_usage_period($1,$2,$3,now()-interval '1 hour',now()+interval '27 days',$4,$5,$5) as id`,
        [org, plan, months, overhead, allowance],
      )
    ).rows[0].id;
  const reserve = async (org, key, kind = "ai", units = 1, cost = 1000) =>
    (
      await db.query("select crm_reserve_usage($1,$2,$3,$4,$5) as id", [
        org,
        key,
        kind,
        units,
        cost,
      ])
    ).rows[0].id;
  const finish = async (org, event, cost, cancel = false) =>
    db.query("select crm_finish_usage($1,$2,$3,$4)", [
      org,
      event,
      cost,
      cancel,
    ]);
  const summary = async () =>
    (await db.query("select crm_usage_summary() as summary")).rows[0].summary;

  await t.test(
    "unconfigured organizations fail closed without changing existing accounts",
    async () => {
      await assert.rejects(
        reserve(a, "unconfigured"),
        /No active usage period/,
      );
      await login(ownerA);
      assert.deepEqual(await summary(), { status: "unconfigured" });
      await login("", "service_role");
    },
  );
  const periodA = await open(a);
  const periodB = await open(b, "pro_plus", 12);
  await t.test(
    "budget is 70 percent of discounted monthly revenue, with overhead reserved",
    async () => {
      const rows = (
        await db.query(
          "select revenue_paise,cost_ceiling_paise from crm_usage_periods order by revenue_paise",
        )
      ).rows;
      assert.equal(Number(rows[0].cost_ceiling_paise), 280000);
      assert.equal(Number(rows[1].revenue_paise), 480000);
      assert.equal(Number(rows[1].cost_ceiling_paise), 336000);
      await assert.rejects(
        reserve(a, "too-expensive", "ai", 1, 270001),
        /budget reached/,
      );
      await assert.rejects(open(a), /cannot overlap/);
      await assert.rejects(reserve(a, "zero", "ai", 1, 0), /Invalid usage/);
    },
  );
  let event;
  await t.test(
    "pending requests consume allowances and duplicate dispatch is denied",
    async () => {
      event = await reserve(a, "ai-1", "ai", 10, 2000);
      await assert.rejects(reserve(a, "ai-2"), /allowance reached/);
      await assert.rejects(
        reserve(a, "ai-1", "ai", 10, 2000),
        /already reserved/,
      );
      await assert.rejects(reserve(a, "ai-1", "ai", 9, 2000), /key conflict/);
      await assert.rejects(finish(b, event, 100), /Unknown usage/);
      await finish(a, event, 1200);
      await finish(a, event, 1200);
      await assert.rejects(finish(a, event, 1300), /already finalized/);
      await assert.rejects(finish(a, event, 0, true), /already finalized/);
    },
  );
  await t.test(
    "confirmed cancellations release reservations but never reuse dispatch keys",
    async () => {
      const cancelled = await reserve(a, "wa-cancel", "whatsapp", 10, 1000);
      await assert.rejects(
        reserve(a, "wa-more", "whatsapp"),
        /allowance reached/,
      );
      await finish(a, cancelled, 0, true);
      await finish(a, cancelled, 0, true);
      await reserve(a, "wa-retry-new-key", "whatsapp", 1, 1000);
      await assert.rejects(
        reserve(a, "wa-cancel", "whatsapp", 10, 1000),
        /already reserved/,
      );
    },
  );
  await t.test(
    "actual overrun is recorded and blocks subsequent spending",
    async () => {
      const overrun = await reserve(b, "overrun");
      await finish(b, overrun, 400000);
      await assert.rejects(reserve(b, "after-overrun"), /budget reached/);
      await login(ownerB);
      const s = await summary();
      assert.equal(s.automation_paused, true);
      assert.equal(s.ai_used, 1);
      await login("", "service_role");
    },
  );
  await t.test(
    "customers only see their own safe summary and cannot write billing state",
    async () => {
      await login(ownerA);
      const s = await summary();
      assert.equal(s.plan, "pro");
      assert.equal(s.ai_used, 10);
      assert.equal(s.whatsapp_used, 1);
      assert.equal(s.automatic_scheduling, false);
      assert.equal(s.revenue_paise, undefined);
      assert.equal(s.cost_ceiling_paise, undefined);
      for (const table of [
        "crm_subscriptions",
        "crm_usage_periods",
        "crm_usage_events",
      ])
        await assert.rejects(
          db.query(`select * from ${table}`),
          /permission denied/,
        );
      await assert.rejects(reserve(b, "forged"), /permission denied/);
      await assert.rejects(open(a), /permission denied/);
      await assert.rejects(finish(a, event, 0), /permission denied/);
      await login("", "anon");
      await assert.rejects(summary(), /permission denied/);
      await login("", "service_role");
    },
  );
  await t.test(
    "included seats are enforced at membership creation and extra seats do not change AI limits",
    async () => {
      await assert.rejects(
        db.query("insert into crm_members values($1,'Agent','team',$2)", [
          teammate,
          a,
        ]),
        /Included seats are full/,
      );
      await login(ownerA);
      const tokenHash = "a".repeat(64);
      const invitation = (
        await db.query("select crm_create_invitation($1,'team',$2) as id", [
          `${teammate}@example.com`,
          tokenHash,
        ])
      ).rows[0].id;
      await login("", "service_role");
      await assert.rejects(
        db.query("select crm_accept_invitation($1,$2,'Agent')", [
          tokenHash,
          teammate,
        ]),
        /Included seats are full/,
      );
      assert.equal(
        (
          await db.query(
            "select accepted_at from crm_invitations where id=$1",
            [invitation],
          )
        ).rows[0].accepted_at,
        null,
      );
      await db.query(
        "update crm_subscriptions set purchased_seats=1 where organization_id=$1",
        [a],
      );
      await db.query("select crm_accept_invitation($1,$2,'Agent')", [
        tokenHash,
        teammate,
      ]);
      await login(teammate);
      await assert.rejects(summary(), /Admin access required/);
      await login(ownerA);
      const s = await summary();
      assert.equal(s.member_count, 2);
      assert.equal(s.purchased_seats, 1);
      assert.equal(s.ai_limit, 10);
      await login("", "service_role");
    },
  );
  await t.test(
    "expiry and inactive subscriptions block new work, while old work can reconcile",
    async () => {
      await db.query(
        "update crm_subscriptions set active=false where organization_id=$1",
        [a],
      );
      await assert.rejects(reserve(a, "inactive"), /Subscription inactive/);
      await db.query(
        "update crm_usage_periods set starts_at=now()-interval '2 months',ends_at=now()-interval '1 month' where id=$1",
        [periodB],
      );
      await assert.rejects(reserve(b, "expired"), /No active usage period/);
      await finish(a, event, 1200);
      await login(ownerB);
      assert.equal((await summary()).status, "inactive");
      await login("", "service_role");
      assert.ok(periodA);
    },
  );
  await t.test(
    "competing reservations cannot both claim the remaining budget",
    async () => {
      const fresh = crypto.randomUUID();
      await db.exec("reset role");
      await db.query(
        "insert into auth.users values($1,'fresh@example.com',now())",
        [fresh],
      );
      await login("", "service_role");
      const org = await provision(fresh);
      await open(org, "pro", 3, 10000, 100);
      const outcomes = await Promise.allSettled([
        reserve(org, "competing-a", "ai", 1, 200000),
        reserve(org, "competing-b", "whatsapp", 1, 200000),
      ]);
      assert.equal(
        outcomes.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        outcomes.filter((result) => result.status === "rejected").length,
        1,
      );
      // PGlite serializes statements; production parallel connections are protected by the SQL row lock.
    },
  );
});
