import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { capturedRazorpayPayment, createRazorpayOrder, verifyCheckoutSignature } from "../src/lib/crm/razorpay.ts";
import { AI_TOPUP } from "../src/lib/crm/plans.ts";

const env = { RAZORPAY_KEY_ID: "rzp_test_offline", RAZORPAY_KEY_SECRET: "offline-secret" };

test("top-up orders, checkout signatures and captured payments", async () => {
  const id = await createRazorpayOrder(env, AI_TOPUP.paise, "topup_1", { kind: "ai_topup" }, async (url, init) => {
    assert.equal(url, "https://api.razorpay.com/v1/orders");
    assert.deepEqual(JSON.parse(init.body), { amount: 9900, currency: "INR", receipt: "topup_1", notes: { kind: "ai_topup" } });
    return Response.json({ id: "order_ABC123" });
  });
  assert.equal(id, "order_ABC123");

  const good = createHmac("sha256", "offline-secret").update("order_ABC123|pay_XYZ").digest("hex");
  assert.equal(verifyCheckoutSignature(env, "order_ABC123", "pay_XYZ", good), true);
  assert.equal(verifyCheckoutSignature(env, "order_ABC123", "pay_OTHER", good), false);
  assert.equal(verifyCheckoutSignature(env, "order_ABC123", "pay_XYZ", "not-hex"), false);

  // An authorized payment is captured before it counts.
  const calls = [];
  const payment = await capturedRazorpayPayment(env, "pay_XYZ", async (url, init) => {
    calls.push(`${init.method} ${url}`);
    return Response.json(
      init.method === "GET"
        ? { status: "authorized", amount: 9900, currency: "INR", order_id: "order_ABC123" }
        : { status: "captured", amount: 9900, currency: "INR", order_id: "order_ABC123" },
    );
  });
  assert.deepEqual(payment, { captured: true, orderId: "order_ABC123", amount: 9900, currency: "INR" });
  assert.deepEqual(calls, [
    "GET https://api.razorpay.com/v1/payments/pay_XYZ",
    "POST https://api.razorpay.com/v1/payments/pay_XYZ/capture",
  ]);
  await assert.rejects(capturedRazorpayPayment(env, "not-a-payment", async () => Response.json({})), /Invalid payment/);
});

test("a paid top-up is credited to this month exactly once", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;",
  );
  for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  const [owner, agent] = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of [owner, agent]) await db.query("insert into auth.users values($1,$2,now())", [id, id + "@test.invalid"]);
  await db.exec("set role service_role");
  const org = (await db.query("select crm_provision_organization($1,'Sunrise Realty','Owner') id", [owner])).rows[0].id;
  await db.query("insert into crm_subscriptions(organization_id,plan,billing_months,active) values($1,'pro_plus',1,true)", [org]);
  await db.query("insert into crm_members(id,organization_id,name,role) values($1,$2,'Agent','team')", [agent, org]);
  const order = (id) => db.query("insert into crm_ai_topups(organization_id,razorpay_order_id,actions,amount_paise) values($1,$2,1000,9900)", [org, id]);
  const apply = (id, payment, amount = 9900) =>
    db.query("select crm_apply_ai_topup($1,$2,$3) r", [id, payment, amount]).then((r) => r.rows[0].r);

  // No paid month yet: refused, so the webhook retries once there is one.
  await order("order_A");
  await assert.rejects(apply("order_A", "pay_1"), /No active paid month/);
  await db.query(
    "insert into crm_usage_periods(organization_id,starts_at,ends_at,revenue_paise,overhead_paise,ai_limit,whatsapp_limit) values($1,now()-interval '1 day',now()+interval '29 days',49900,10000,1000,100)",
    [org],
  );
  const period = async () => (await db.query("select ai_limit,revenue_paise from crm_usage_periods where organization_id=$1", [org])).rows[0];
  await assert.rejects(apply("order_A", "pay_1", 100), /amount mismatch/);
  assert.equal((await apply("order_A", "pay_1")).applied, true);
  const after = await period();
  assert.deepEqual([after.ai_limit, Number(after.revenue_paise)], [2000, 59800]);
  // The callback and the webhook both arrive: the second changes nothing.
  assert.equal((await apply("order_A", "pay_1")).applied, false);
  assert.equal((await period()).ai_limit, 2000);
  await assert.rejects(apply("order_A", "pay_2"), /already paid by another payment/);
  await assert.rejects(apply("order_UNKNOWN", "pay_3"), /Unknown top-up/);

  // Owners see their top-ups; team members don't.
  const read = async (user) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec("set role authenticated");
    const n = (await db.query("select count(*)::int n from crm_ai_topups")).rows[0].n;
    await db.exec("reset role");
    await db.exec("set role service_role");
    return n;
  };
  assert.equal(await read(owner), 1);
  assert.equal(await read(agent), 0);
});
