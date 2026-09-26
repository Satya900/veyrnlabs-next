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
  } catch (err) {
    console.error("razorpay webhook: invalid payload", err);
    return new Response("Invalid payload", { status: 400 });
  }
  const signatureHeader = request.headers.get("x-razorpay-signature");
  if (!(await verifyRazorpayWebhook(process.env, raw, signatureHeader))) {
    if (process.env.VERCEL_ENV === "preview") {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
      console.error("razorpay webhook debug: signature mismatch", {
        secretLen: secret.length,
        secretPrefix: secret.slice(0, 6),
        secretSuffix: secret.slice(-6),
        signatureHeaderPresent: Boolean(signatureHeader),
        signatureHeaderLen: signatureHeader?.length ?? 0,
        signatureHeaderValid: signatureHeader
          ? /^[a-f0-9]{64}$/.test(signatureHeader)
          : false,
        rawBodyLen: raw.length,
        allHeaderNames: [...request.headers.keys()],
      });
    }
    return new Response("Invalid signature", { status: 401 });
  }
  let parsed;
  try {
    parsed = parsePaidRazorpayEvent(JSON.parse(Buffer.from(raw).toString("utf8")));
  } catch (err) {
    console.error("razorpay webhook: invalid event", err);
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
    } catch (err) {
      console.error("razorpay webhook: billing allowances not configured", err);
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
  if (error) {
    console.error("razorpay webhook: crm_apply_paid_event failed", {
      subscriptionId: parsed.subscriptionId,
      status: parsed.status,
      message: error.message,
    });
    return new Response("Please retry", { status: 503 });
  }
  return Response.json({ received: true });
}
