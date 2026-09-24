import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";
import {
  CRM_PLANS,
  BILLING_DISCOUNTS,
  planPrice,
  type BillingMonths,
  type PlanId,
} from "@/lib/crm/plans";
import {
  billingAllowances,
  cancelRazorpaySubscription,
  createCheckoutSubscription,
  razorpayEnabled,
  razorpayPlanId,
  RazorpayRejected,
} from "@/lib/crm/razorpay";

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (!razorpayEnabled(process.env))
    return Response.json(
      { error: "Billing is not enabled yet." },
      { status: 503 },
    );
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (auth.member.role !== "owner")
    return Response.json(
      { error: "Only the owner manages billing." },
      { status: 403 },
    );
  const db = supabase(undefined, true);
  let attemptId: string | undefined;
  try {
    const body = await jsonBody(request, 1000);
    const { data: member } = await db
      .from("crm_members")
      .select("organization_id")
      .eq("id", auth.member.id)
      .single();
    if (!member) throw new Error("Workspace unavailable.");
    if (body.action === "resume" || body.action === "cancel") {
      const { data: base } = await db
        .from("crm_billing_subscriptions")
        .select("razorpay_subscription_id,status")
        .eq("organization_id", member.organization_id)
        .maybeSingle();
      const { data: seat } =
        typeof body.subscriptionId === "string"
          ? await db
              .from("crm_seat_subscriptions")
              .select("id,status")
              .eq("organization_id", member.organization_id)
              .eq("id", body.subscriptionId)
              .maybeSingle()
          : { data: null };
      const id = seat?.id ?? base?.razorpay_subscription_id;
      const status = seat?.status ?? base?.status;
      if (!id || (body.subscriptionId && body.subscriptionId !== id))
        throw new Error("Subscription unavailable.");
      if (body.action === "resume") {
        if (status !== "created")
          throw new Error("This subscription is no longer awaiting checkout.");
        return Response.json({
          subscriptionId: id,
          keyId: process.env.RAZORPAY_KEY_ID,
        });
      }
      const result = await cancelRazorpaySubscription(
        process.env,
        id,
        status !== "created" && status !== "authenticated",
      );
      if (result.status === "cancelled") {
        const update = seat
          ? db
              .from("crm_seat_subscriptions")
              .update({ status: "cancelled" })
              .eq("id", id)
          : db
              .from("crm_billing_subscriptions")
              .update({ status: "cancelled" })
              .eq("organization_id", member.organization_id);
        const { error } = await update;
        if (error)
          throw new Error(
            "Cancellation sent; waiting for the payment webhook to update your plan.",
          );
      }
      return Response.json({
        ok: true,
        message:
          "Cancellation recorded. Already-paid access remains until its end date.",
      });
    }
    const seats = body.action === "subscribe-seats";
    if (!seats && body.action !== "subscribe")
      throw new Error("Unknown action.");
    const quantity = seats ? body.quantity : 1;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    )
      throw new Error("Choose between 1 and 100 seats.");
    const plan = body.plan as PlanId,
      months = (seats ? 1 : body.months) as BillingMonths;
    if (
      !seats &&
      (!Object.hasOwn(CRM_PLANS, plan) ||
        !Object.hasOwn(BILLING_DISCOUNTS, months))
    )
      throw new Error("Choose a valid plan and duration.");
    if (!seats) billingAllowances(process.env, plan);
    const providerPlan = seats
      ? process.env.RAZORPAY_PLAN_EXTRA_SEAT
      : razorpayPlanId(process.env, plan, months);
    if (!providerPlan)
      throw new Error("Extra-seat billing is not configured yet.");
    const { data: attempt, error } = await auth.db.rpc("crm_begin_checkout", {
      checkout_kind: seats ? "seats" : "base",
      selected_plan: seats ? null : plan,
      months,
      seats: quantity,
    });
    if (error || !attempt)
      throw new Error(error?.message || "Checkout unavailable.");
    if (!attempt.run) {
      if (attempt.subscription_id)
        return Response.json({
          subscriptionId: attempt.subscription_id,
          keyId: process.env.RAZORPAY_KEY_ID,
        });
      throw new Error(
        "A checkout is still being created or needs reconciliation. Please contact support before trying again.",
      );
    }
    attemptId = attempt.id;
    const id = await createCheckoutSubscription(
      process.env,
      providerPlan,
      quantity,
      months,
      seats ? 50000 : planPrice(plan, months).totalPaise,
      attempt.id,
    );
    const { error: saveError } = await db.rpc("crm_finish_checkout", {
      attempt_id: attempt.id,
      provider_id: id,
      provider_plan: providerPlan,
    });
    if (saveError)
      throw new Error(
        "Checkout was created but needs reconciliation. Contact support.",
      );
    return Response.json({
      subscriptionId: id,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    if (attemptId)
      await db.rpc("crm_finish_checkout", {
        attempt_id: attemptId,
        provider_id: error instanceof RazorpayRejected ? "" : null,
        provider_plan: null,
      });
    return Response.json(
      { error: error instanceof Error ? error.message : "Checkout failed." },
      { status: 400 },
    );
  }
}
