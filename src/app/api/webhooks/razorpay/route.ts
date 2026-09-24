import { createHash } from "node:crypto";
import { supabase } from "@/lib/crm/server";
import {
  billingAllowances,
  parsePaidRazorpayEvent,
  razorpayConfigured,
  readRazorpayWebhookBody,
  verifyRazorpayWebhook,
} from "@/lib/crm/razorpay";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!razorpayConfigured(process.env))
    return new Response("Webhook unavailable", { status: 503 });
  let raw: Uint8Array;
  try {
    raw = await readRazorpayWebhookBody(request);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  if (
    !(await verifyRazorpayWebhook(
      process.env,
      raw,
      request.headers.get("x-razorpay-signature"),
    ))
  )
    return new Response("Invalid signature", { status: 401 });
  let parsed;
  try {
    parsed = parsePaidRazorpayEvent(JSON.parse(Buffer.from(raw).toString("utf8")));
  } catch {
    return new Response("Invalid event", { status: 400 });
  }
  const db = supabase(undefined, true);
  // Only compute allowances (and thus decide whether we can safely open a period) BEFORE
  // recording the event as handled. If anything here is missing, return 503 without calling
  // crm_apply_paid_event at all, so Razorpay's retry can complete the full, still-atomic
  // dedupe-plus-activation once the gap is fixed, instead of a half-applied event that a later
  // identical retry would then skip as already processed.
  let overheadPaise = 0,
    aiAllowance = 0,
    whatsappAllowance = 0;
  if (parsed.openPeriod) {
    const { data: sub } = await db
      .from("crm_billing_subscriptions")
      .select("plan,billing_months")
      .eq("razorpay_subscription_id", parsed.subscriptionId)
      .maybeSingle();
    if (!sub) {
      const { data: seat } = await db.from("crm_seat_subscriptions").select("id").eq("id", parsed.subscriptionId).maybeSingle();
      if (!seat) return new Response("Unknown subscription; please retry", { status: 503 });
    }
    try {
      if (sub) ({ overheadPaise, aiAllowance, whatsappAllowance } = billingAllowances(
        process.env,
        sub.plan,
      ));
    } catch {
      return new Response(
        "Billing allowances not configured; please retry",
        { status: 503 },
      );
    }
  }
  const eventId = createHash("sha256").update(raw).digest("hex");
  const { error } = await db.rpc("crm_apply_paid_event", {
    event_key: eventId,
    subscription_id: parsed.subscriptionId,
    provider_plan: parsed.providerPlan,
    new_status: parsed.status,
    occurred_at: parsed.occurredAt,
    payment_id: parsed.paymentId,
    cycle_start: parsed.cycleStart,
    cycle_end: parsed.cycleEnd,
    paid_amount: parsed.amount,
    currency: parsed.currency,
    overhead: overheadPaise,
    ai_allowance: aiAllowance,
    whatsapp_allowance: whatsappAllowance,
  });
  if (error) return new Response("Please retry", { status: 503 });
  return Response.json({ received: true });
}
