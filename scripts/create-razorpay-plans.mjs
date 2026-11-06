// Creates the Razorpay subscription Plans for the CRM price card and prints the
// RAZORPAY_PLAN_* env values to set in Vercel.
//
//   node --env-file=.env.razorpay-live scripts/create-razorpay-plans.mjs           # dry run
//   node --env-file=.env.razorpay-live scripts/create-razorpay-plans.mjs --apply   # create
//
// The env file needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (.env* is gitignored).
// Plans are tagged with a notes.veyrn_plan key, so a rerun reuses matching Plans instead of
// creating duplicates. Razorpay Plans can't be edited or deleted, so a Plan whose amount no
// longer matches is reported and left alone; the new one gets created alongside it.
import { CRM_PLANS, EXTRA_SEAT_PAISE, planPrice } from "../src/lib/crm/plans.ts";

const apply = process.argv.includes("--apply");
const keyId = process.env.RAZORPAY_KEY_ID ?? "";
const secret = process.env.RAZORPAY_KEY_SECRET ?? "";
if (!/^rzp_(test|live)_/.test(keyId) || !secret) {
  console.error("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (use --env-file).");
  process.exit(1);
}
const mode = keyId.startsWith("rzp_live_") ? "LIVE" : "test";
const auth = "Basic " + Buffer.from(`${keyId}:${secret}`).toString("base64");

async function razorpay(path, init = {}) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`${res.status} ${body?.error?.description ?? "Razorpay request failed"}`);
  return body;
}

// Must match what createCheckoutSubscription checks: period monthly, interval = months
// billed, item.amount = the full charge per cycle, currency INR.
const periodName = { 1: "Monthly", 3: "Quarterly", 12: "Annual" };
const wanted = [];
for (const [plan, info] of Object.entries(CRM_PLANS))
  for (const months of [1, 3, 12])
    wanted.push({
      env: `RAZORPAY_PLAN_${plan.toUpperCase()}_${months}`,
      key: `${plan}_${months}`,
      interval: months,
      amount: planPrice(plan, months).totalPaise,
      name: `Veyrn CRM ${info.name} (${periodName[months]})`,
    });
wanted.push({
  env: "RAZORPAY_PLAN_EXTRA_SEAT",
  key: "extra_seat_1",
  interval: 1,
  amount: EXTRA_SEAT_PAISE,
  name: "Veyrn CRM extra user (Monthly)",
});

const existing = [];
for (let skip = 0; ; skip += 100) {
  const page = await razorpay(`/plans?count=100&skip=${skip}`);
  existing.push(...page.items);
  if (page.items.length < 100) break;
}

console.log(`Razorpay ${mode} mode, ${apply ? "creating plans" : "dry run (add --apply to create)"}\n`);
const output = [];
for (const plan of wanted) {
  const rupees = `₹${(plan.amount / 100).toLocaleString("en-IN")}`;
  const match = existing.find(
    (p) =>
      p.notes?.veyrn_plan === plan.key &&
      p.period === "monthly" &&
      p.interval === plan.interval &&
      p.item?.amount === plan.amount &&
      p.item?.currency === "INR",
  );
  if (match) {
    console.log(`reuse   ${plan.name}: ${rupees} every ${plan.interval} month(s) -> ${match.id}`);
    output.push(`${plan.env}=${match.id}`);
    continue;
  }
  const stale = existing.filter((p) => p.notes?.veyrn_plan === plan.key);
  for (const p of stale)
    console.log(`stale   ${p.id} is tagged ${plan.key} but charges ₹${p.item.amount / 100}; leaving it`);
  if (!apply) {
    console.log(`create  ${plan.name}: ${rupees} every ${plan.interval} month(s)`);
    output.push(`${plan.env}=<created on --apply>`);
    continue;
  }
  const created = await razorpay("/plans", {
    method: "POST",
    body: JSON.stringify({
      period: "monthly",
      interval: plan.interval,
      item: {
        name: plan.name,
        amount: plan.amount,
        currency: "INR",
        description: "Prices exclusive of GST.",
      },
      notes: { veyrn_plan: plan.key },
    }),
  });
  console.log(`created ${plan.name}: ${rupees} every ${plan.interval} month(s) -> ${created.id}`);
  output.push(`${plan.env}=${created.id}`);
}

console.log("\nSet these in Vercel (production):\n");
console.log(output.join("\n"));
