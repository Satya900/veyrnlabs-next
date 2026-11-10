import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";
import { AI_TOPUP } from "@/lib/crm/plans";
import {
  capturedRazorpayPayment,
  createRazorpayOrder,
  RazorpayRejected,
  razorpayEnabled,
  verifyCheckoutSignature,
} from "@/lib/crm/razorpay";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/**
 * AI top-ups for the workspace owner (who also manages billing).
 * create: records a Razorpay order for one pack and returns what Checkout needs.
 * verify: checks Checkout's signature and the captured payment, then credits the actions.
 * The order.paid webhook credits it too if the browser closes first; crediting is idempotent.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (auth.member.role !== "owner")
    return Response.json({ error: "Only the workspace owner can buy AI top-ups." }, { status: 403 });
  if (!razorpayEnabled(process.env))
    return Response.json({ error: "Payments aren't available right now." }, { status: 503 });
  const db = supabase(undefined, true);
  try {
    const body = await jsonBody(request, 4000);
    if (body.action === "create") {
      const now = new Date().toISOString();
      const { data: period } = await db
        .from("crm_usage_periods")
        .select("id")
        .eq("organization_id", auth.organizationId)
        .is("trial_budget_paise", null)
        .lte("starts_at", now)
        .gt("ends_at", now)
        .maybeSingle();
      if (!period) throw new Error("Top-ups need an active paid plan.");
      const orderId = await createRazorpayOrder(
        process.env,
        AI_TOPUP.paise,
        `topup_${crypto.randomUUID().slice(0, 18)}`,
        { kind: "ai_topup", organization_id: auth.organizationId, actions: String(AI_TOPUP.actions) },
      );
      const { error } = await db.from("crm_ai_topups").insert({
        organization_id: auth.organizationId,
        razorpay_order_id: orderId,
        actions: AI_TOPUP.actions,
        amount_paise: AI_TOPUP.paise,
        created_by: auth.member.id,
      });
      if (error) throw new Error("The top-up couldn't be started. Try again.");
      return Response.json(
        { orderId, keyId: process.env.RAZORPAY_KEY_ID, amount: AI_TOPUP.paise, actions: AI_TOPUP.actions },
        { headers },
      );
    }
    if (body.action === "verify") {
      const orderId = typeof body.orderId === "string" ? body.orderId : "";
      const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
      const { data: topup } = await db
        .from("crm_ai_topups")
        .select("razorpay_order_id,amount_paise,status")
        .eq("organization_id", auth.organizationId)
        .eq("razorpay_order_id", orderId)
        .maybeSingle();
      if (!topup) throw new Error("Unknown top-up.");
      if (!verifyCheckoutSignature(process.env, orderId, paymentId, body.signature))
        throw new Error("The payment couldn't be verified. If you were charged, it will be credited within a few minutes.");
      const payment = await capturedRazorpayPayment(process.env, paymentId);
      if (!payment.captured || payment.orderId !== orderId || payment.amount !== topup.amount_paise || payment.currency !== "INR")
        throw new Error("The payment isn't complete yet. If you were charged, it will be credited within a few minutes.");
      const { data, error } = await db.rpc("crm_apply_ai_topup", {
        order_id: orderId,
        payment_id: paymentId,
        paid_amount: payment.amount,
      });
      if (error) {
        console.error("ai topup: credit failed", { orderId, message: error.message });
        throw new Error("Payment received, but the actions couldn't be added yet. We'll add them shortly; contact support if not.");
      }
      return Response.json({ ok: true, actions: data.actions }, { headers });
    }
    throw new Error("Unknown action.");
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RazorpayRejected || error instanceof Error
            ? error.message
            : "Top-up failed.",
      },
      { status: 400, headers },
    );
  }
}
