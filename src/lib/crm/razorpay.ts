import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingMonths, PlanId } from "./plans";

type Env = Record<string, string | undefined>;
export class RazorpayRejected extends Error {}

export function razorpayConfigured(env: Env) {
  return Boolean(
    env.RAZORPAY_KEY_ID &&
    env.RAZORPAY_KEY_SECRET &&
    env.RAZORPAY_WEBHOOK_SECRET,
  );
}
export function razorpayEnabled(env: Env) {
  return env.RAZORPAY_ENABLED === "true" && razorpayConfigured(env);
}

const PLAN_ENV: Record<string, string> = {
  "pro:1": "RAZORPAY_PLAN_PRO_1",
  "pro:3": "RAZORPAY_PLAN_PRO_3",
  "pro:12": "RAZORPAY_PLAN_PRO_12",
  "pro_plus:1": "RAZORPAY_PLAN_PRO_PLUS_1",
  "pro_plus:3": "RAZORPAY_PLAN_PRO_PLUS_3",
  "pro_plus:12": "RAZORPAY_PLAN_PRO_PLUS_12",
};
// Ten years of billing cycles at each interval; Razorpay requires a fixed total_count rather
// than an indefinite subscription. The customer's plan still renews until they cancel.
const TOTAL_COUNT: Record<BillingMonths, number> = { 1: 120, 3: 40, 12: 10 };

export function razorpayPlanId(env: Env, plan: PlanId, months: BillingMonths) {
  const key = PLAN_ENV[`${plan}:${months}`];
  const id = key && env[key];
  if (!id) throw new Error("Billing is not configured for this plan yet.");
  return id;
}

async function razorpayFetch(
  env: Env,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
) {
  const auth = Buffer.from(
    `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
  ).toString("base64");
  const res = await fetchImpl(`https://api.razorpay.com/v1${path}`, {
    ...init,
    signal: AbortSignal.timeout(15000),
    headers: {
      ...init.headers,
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500)
      throw new RazorpayRejected(
        body?.error?.description || "Razorpay rejected the request.",
      );
    throw new Error("Razorpay request outcome is uncertain.");
  }
  return body as Record<string, unknown>;
}

/** Creates a recurring Razorpay subscription. The customer completes payment client-side
 * with Razorpay Checkout using the returned id; entitlement activation happens only from
 * the verified webhook, never from this call succeeding. */
export async function createRazorpaySubscription(
  env: Env,
  plan: PlanId,
  months: BillingMonths,
  fetchImpl: typeof fetch = fetch,
) {
  const razorpayPlan = razorpayPlanId(env, plan, months);
  const body = await razorpayFetch(
    env,
    "/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        plan_id: razorpayPlan,
        total_count: TOTAL_COUNT[months],
        customer_notify: 1,
      }),
    },
    fetchImpl,
  );
  if (typeof body.id !== "string")
    throw new Error("Razorpay did not return a subscription id.");
  return { subscriptionId: body.id, razorpayPlan };
}

/** Operator-reviewed rates only; never invents an allowance if unset. */
export function billingAllowances(env: Env, plan: PlanId) {
  const prefix = plan === "pro" ? "PRO" : "PRO_PLUS";
  const overhead = Number(env[`CRM_OVERHEAD_${prefix}_PAISE`]);
  const ai = Number(env[`CRM_AI_ALLOWANCE_${prefix}`]);
  const whatsapp = Number(env[`CRM_WHATSAPP_ALLOWANCE_${prefix}`]);
  if (
    !Number.isSafeInteger(overhead) ||
    overhead <= 0 ||
    !Number.isSafeInteger(ai) ||
    ai <= 0 ||
    !Number.isSafeInteger(whatsapp) ||
    whatsapp <= 0
  )
    throw new Error("Billing allowances are not configured for this plan yet.");
  return {
    overheadPaise: overhead,
    aiAllowance: ai,
    whatsappAllowance: whatsapp,
  };
}

export async function verifyRazorpayWebhook(
  env: Env,
  raw: Uint8Array,
  signature: string | null,
) {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Razorpay's own subscription status values, unconfirmed against a live delivery. Review
// against a real webhook payload during hosted verification before relying on this in production.
const RAZORPAY_STATUSES = new Set([
  "created",
  "authenticated",
  "active",
  "pending",
  "halted",
  "cancelled",
  "completed",
  "paused",
  "expired",
]);

export function parseRazorpayWebhook(payload: unknown) {
  const root = (payload ?? {}) as Record<string, unknown>;
  const event = root.event;
  const sub = ((
    (root.payload as Record<string, unknown> | undefined)?.subscription as
      Record<string, unknown> | undefined
  )?.entity ?? {}) as Record<string, unknown>;
  if (typeof event !== "string" || typeof sub.id !== "string" || !sub.id)
    throw new Error("Invalid Razorpay event");
  const status = typeof sub.status === "string" ? sub.status : "";
  if (!RAZORPAY_STATUSES.has(status))
    throw new Error("Unrecognized subscription status");
  return {
    event,
    subscriptionId: sub.id,
    status,
    openPeriod: event === "subscription.charged",
  };
}

export async function readRazorpayWebhookBody(
  request: Request,
  limit = 1_048_576,
) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("Expected JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Payload too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function parsePaidRazorpayEvent(payload: unknown) {
  const parsed = parseRazorpayWebhook(payload);
  const root = payload as {
    created_at?: number;
    payload?: {
      subscription?: {
        entity?: {
          plan_id?: string;
          current_start?: number;
          current_end?: number;
        };
      };
      payment?: {
        entity?: {
          id?: string;
          amount?: number;
          currency?: string;
          status?: string;
        };
      };
    };
  };
  const sub = root.payload?.subscription?.entity;
  const payment = root.payload?.payment?.entity;
  if (!Number.isSafeInteger(root.created_at) || !sub?.plan_id)
    throw new Error("Missing event identity");
  if (
    parsed.openPeriod &&
    (!payment?.id ||
      payment.status !== "captured" ||
      !Number.isSafeInteger(payment.amount) ||
      !Number.isSafeInteger(sub.current_start) ||
      !Number.isSafeInteger(sub.current_end))
  )
    throw new Error("Missing captured payment or billing dates");
  return {
    ...parsed,
    providerPlan: sub.plan_id,
    occurredAt: new Date(root.created_at! * 1000).toISOString(),
    paymentId: parsed.openPeriod ? payment!.id! : null,
    amount: parsed.openPeriod ? payment!.amount! : null,
    currency: parsed.openPeriod ? payment!.currency : null,
    cycleStart: parsed.openPeriod
      ? new Date(sub.current_start! * 1000).toISOString()
      : null,
    cycleEnd: parsed.openPeriod
      ? new Date(sub.current_end! * 1000).toISOString()
      : null,
  };
}

export async function createCheckoutSubscription(
  env: Env,
  planId: string,
  quantity: number,
  months: BillingMonths,
  unitAmount: number,
  attemptId: string,
  request: typeof fetch = fetch,
) {
  // Verify dashboard mapping before opening a checkout that could charge the wrong amount.
  const plan = await razorpayFetch(
    env,
    `/plans/${encodeURIComponent(planId)}`,
    { method: "GET" },
    request,
  );
  const item = plan.item as { amount?: number; currency?: string } | undefined;
  if (
    plan.period !== "monthly" ||
    plan.interval !== months ||
    item?.amount !== unitAmount ||
    item.currency !== "INR"
  )
    throw new RazorpayRejected(
      "The payment plan configuration does not match this price. Contact support.",
    );
  const result = await razorpayFetch(
    env,
    "/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        plan_id: planId,
        quantity,
        total_count: TOTAL_COUNT[months],
        customer_notify: 1,
        notes: { crm_attempt_id: attemptId },
      }),
    },
    request,
  );
  if (typeof result.id !== "string")
    throw new Error("Subscription creation needs reconciliation.");
  return result.id;
}

export async function cancelRazorpaySubscription(
  env: Env,
  id: string,
  atCycleEnd: boolean,
  request: typeof fetch = fetch,
) {
  return razorpayFetch(
    env,
    `/subscriptions/${encodeURIComponent(id)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ cancel_at_cycle_end: atCycleEnd ? 1 : 0 }),
    },
    request,
  );
}
