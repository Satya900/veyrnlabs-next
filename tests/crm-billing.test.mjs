import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  billingAllowances,
  createRazorpaySubscription,
  parseRazorpayWebhook,
  razorpayConfigured,
  razorpayEnabled,
  razorpayPlanId,
  verifyRazorpayWebhook,
} from "../src/lib/crm/razorpay.ts";

const env = {
  RAZORPAY_ENABLED: "true",
  RAZORPAY_KEY_ID: "rzp_test_offline",
  RAZORPAY_KEY_SECRET: "offline-secret",
  RAZORPAY_WEBHOOK_SECRET: "offline-webhook-secret",
  RAZORPAY_PLAN_PRO_1: "plan_pro_1",
  RAZORPAY_PLAN_PRO_3: "plan_pro_3",
  RAZORPAY_PLAN_PRO_12: "plan_pro_12",
  RAZORPAY_PLAN_PRO_PLUS_1: "plan_pro_plus_1",
  RAZORPAY_PLAN_PRO_PLUS_3: "plan_pro_plus_3",
  RAZORPAY_PLAN_PRO_PLUS_12: "plan_pro_plus_12",
  CRM_OVERHEAD_PRO_PAISE: "50000",
  CRM_AI_ALLOWANCE_PRO: "100",
  CRM_WHATSAPP_ALLOWANCE_PRO: "50",
};

test("razorpayConfigured/razorpayEnabled fail closed until every credential is set", () => {
  assert.ok(razorpayConfigured(env));
  assert.ok(razorpayEnabled(env));
  for (const key of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"])
    assert.equal(razorpayConfigured({ ...env, [key]: "" }), false);
  assert.equal(razorpayEnabled({ ...env, RAZORPAY_ENABLED: "false" }), false);
  assert.equal(razorpayEnabled({ ...env, RAZORPAY_ENABLED: undefined }), false);
});

test("razorpayPlanId requires every plan/period combination to be explicitly configured", () => {
  assert.equal(razorpayPlanId(env, "pro", 1), "plan_pro_1");
  assert.equal(razorpayPlanId(env, "pro_plus", 12), "plan_pro_plus_12");
  assert.throws(() => razorpayPlanId({ ...env, RAZORPAY_PLAN_PRO_3: "" }, "pro", 3));
});

test("billingAllowances never invents a rate and requires all three positive integers", () => {
  assert.deepEqual(billingAllowances(env, "pro"), {
    overheadPaise: 50000,
    aiAllowance: 100,
    whatsappAllowance: 50,
  });
  assert.throws(() => billingAllowances(env, "pro_plus"));
  assert.throws(() => billingAllowances({ ...env, CRM_AI_ALLOWANCE_PRO: "0" }, "pro"));
  assert.throws(() => billingAllowances({ ...env, CRM_WHATSAPP_ALLOWANCE_PRO: "-1" }, "pro"));
});

test("createRazorpaySubscription sends the mapped plan id and a fixed total_count", async () => {
  let calls = 0;
  const result = await createRazorpaySubscription(env, "pro_plus", 3, async (url, init) => {
    calls++;
    assert.equal(url, "https://api.razorpay.com/v1/subscriptions");
    const body = JSON.parse(init.body);
    assert.equal(body.plan_id, "plan_pro_plus_3");
    assert.equal(body.total_count, 40);
    assert.equal(body.customer_notify, 1);
    assert.equal(
      init.headers.Authorization,
      `Basic ${Buffer.from("rzp_test_offline:offline-secret").toString("base64")}`,
    );
    return Response.json({ id: "sub_offline_1" });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { subscriptionId: "sub_offline_1", razorpayPlan: "plan_pro_plus_3" });
  await assert.rejects(
    createRazorpaySubscription(env, "pro", 1, async () =>
      Response.json({ error: { description: "bad request" } }, { status: 400 }),
    ),
    /bad request/,
  );
});

test("verifyRazorpayWebhook checks the exact raw body and rejects forged or missing signatures", async () => {
  const raw = Buffer.from(JSON.stringify({ event: "subscription.charged" }));
  const good = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  assert.ok(await verifyRazorpayWebhook(env, raw, good));
  assert.equal(await verifyRazorpayWebhook(env, raw, null), false);
  assert.equal(await verifyRazorpayWebhook(env, raw, "not-hex"), false);
  assert.equal(await verifyRazorpayWebhook(env, raw, "a".repeat(64)), false);
  assert.equal(await verifyRazorpayWebhook({ ...env, RAZORPAY_WEBHOOK_SECRET: "" }, raw, good), false);
});

test("parseRazorpayWebhook extracts subscription id/status and flags only genuine charges", () => {
  const charged = parseRazorpayWebhook({
    event: "subscription.charged",
    payload: { subscription: { entity: { id: "sub_1", status: "active" } } },
  });
  assert.deepEqual(charged, {
    event: "subscription.charged",
    subscriptionId: "sub_1",
    status: "active",
    openPeriod: true,
  });
  const cancelled = parseRazorpayWebhook({
    event: "subscription.cancelled",
    payload: { subscription: { entity: { id: "sub_1", status: "cancelled" } } },
  });
  assert.equal(cancelled.openPeriod, false);
  assert.throws(() => parseRazorpayWebhook({ event: "subscription.charged", payload: {} }));
  assert.throws(() =>
    parseRazorpayWebhook({
      event: "subscription.charged",
      payload: { subscription: { entity: { id: "sub_1", status: "made-up" } } },
    }),
  );
  assert.throws(() => parseRazorpayWebhook(null));
});

test("subscription start and webhook activation enforce ownership, tenancy, and idempotent charges", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const migrate = async (name) =>
    db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  for (const file of [
    "202609140001_crm",
    "202609150001_crm_saved_views",
    "202609150002_crm_capture_returns_inserted",
    "202609220001_crm_organizations",
    "202609230002_crm_usage_budgets",
    "202609240001_crm_ai_trial",
    "202609240003_crm_trial_replies",
    "202609240007_crm_billing",
  ])
    await migrate(file);

  const ids = Object.fromEntries(
    ["ownerA", "adminA", "ownerB"].map((k) => [k, crypto.randomUUID()]),
  );
  for (const id of Object.values(ids))
    await db.query("insert into auth.users values($1)", [id]);
  const login = async (id = "", role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  const provision = async (id, name) =>
    (
      await db.query("select crm_provision_organization($1,$2,$2) as id", [id, name])
    ).rows[0].id;
  await login("", "service_role");
  const orgA = await provision(ids.ownerA, "A");
  await provision(ids.ownerB, "B");
  await db.query(
    "insert into crm_members(id,organization_id,name,role) values($1,$2,'Admin','admin')",
    [ids.adminA, orgA],
  );

  const startSub = (subId, planId = "plan_pro_1", plan = "pro", months = 1) =>
    db.query(
      "select crm_start_subscription($1,$2,$3,$4)",
      [plan, months, subId, planId],
    );

  await t.test("only the owner starts a subscription, with valid plan/period", async () => {
    await login(ids.adminA);
    await assert.rejects(startSub("sub_x", "plan_x"), /Only the owner/);
    await login(ids.ownerA);
    await assert.rejects(
      db.query("select crm_start_subscription('bogus',1,'sub_x','plan_x')"),
    );
    await assert.rejects(
      db.query("select crm_start_subscription('pro',2,'sub_x','plan_x')"),
    );
  });

  let eventCounter = 0;
  const eventId = () =>
    createHash("sha256").update(String(eventCounter++)).digest("hex");
  const applyWebhook = (subId, status, openPeriod, overhead = 50000, ai = 100, wa = 50) =>
    db.query(
      "select crm_apply_billing_webhook($1,$2,$3,$4,$5,$6,$7)",
      [eventId(), subId, status, openPeriod, overhead, ai, wa],
    );

  // orgA already has two members (owner + admin), so the subscription used from here on
  // is Pro Plus (3 included seats), matching crm_open_usage_period's own seat check.
  await t.test(
    "starting a subscription is idempotent for retries but blocks a second concurrent one",
    async () => {
      await login(ids.ownerA);
      await startSub("sub_A", "plan_pro_plus_1", "pro_plus", 1);
      await login("", "service_role");
      const row = (
        await db.query(
          "select status,plan,billing_months from crm_billing_subscriptions where organization_id=$1",
          [orgA],
        )
      ).rows[0];
      assert.deepEqual(row, { status: "created", plan: "pro_plus", billing_months: 1 });
      await login(ids.ownerA);
      await assert.rejects(
        startSub("sub_A_retry", "plan_pro_3", "pro_plus", 3),
        /already exists/,
      );
    },
  );

  await t.test(
    "an unverified/unrelated caller cannot start or apply billing changes",
    async () => {
      await login("", "anon");
      await assert.rejects(startSub("sub_anon", "plan_pro_1"));
      await assert.rejects(applyWebhook("sub_A", "active", false));
    },
  );

  await t.test(
    "a genuine charge activates the subscription, opens exactly one usage period, and a replayed delivery of the same event is a silent no-op",
    async () => {
      await login("", "service_role");
      const chargeEvent = eventId();
      const apply = () =>
        db.query(
          "select crm_apply_billing_webhook($1,'sub_A','active',true,50000,100,50)",
          [chargeEvent],
        );
      await apply();
      const sub = (
        await db.query(
          "select status from crm_billing_subscriptions where organization_id=$1",
          [orgA],
        )
      ).rows[0];
      assert.equal(sub.status, "active");
      const afterFirst = await db.query(
        "select count(*) from crm_usage_periods where organization_id=$1 and trial_budget_paise is null",
        [orgA],
      );
      assert.equal(Number(afterFirst.rows[0].count), 1);
      // Same event id delivered again (Razorpay retry): must not open a second period.
      await apply();
      const afterReplay = await db.query(
        "select count(*) from crm_usage_periods where organization_id=$1 and trial_budget_paise is null",
        [orgA],
      );
      assert.equal(Number(afterReplay.rows[0].count), 1);
    },
  );

  await t.test("a pure status transition never opens a period", async () => {
    await login("", "service_role");
    const before = await db.query(
      "select count(*) from crm_usage_periods where organization_id=$1 and trial_budget_paise is null",
      [orgA],
    );
    await applyWebhook("sub_A", "halted", false);
    const after = await db.query(
      "select count(*) from crm_usage_periods where organization_id=$1 and trial_budget_paise is null",
      [orgA],
    );
    assert.equal(after.rows[0].count, before.rows[0].count);
    assert.equal(
      (
        await db.query("select status from crm_billing_subscriptions where organization_id=$1", [orgA])
      ).rows[0].status,
      "halted",
    );
  });

  await t.test("an unknown subscription id is rejected rather than silently accepted", async () => {
    await login("", "service_role");
    await assert.rejects(applyWebhook("sub_does_not_exist", "active", false), /Unknown subscription/);
  });

  await t.test(
    "crm_usage_summary exposes billing_status without letting a Razorpay halt retroactively revoke the open period",
    async () => {
      await login(ids.ownerA);
      const summary = (await db.query("select crm_usage_summary() as s")).rows[0].s;
      // Razorpay-side halt is surfaced for the UI, but access continues until the
      // already-open usage period ends; halting does not retroactively revoke it.
      assert.equal(summary.billing_status, "halted");
      assert.equal(summary.status, "active");
      assert.equal(summary.plan, "pro_plus");
    },
  );
});
