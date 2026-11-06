import { session, supabase } from "@/lib/crm/server";

export async function GET() {
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (auth.member.role === "team")
    return Response.json(
      { error: "Only owners and admins can view plan usage." },
      { status: 403 },
    );
  const { data, error } = await auth.db.rpc("crm_usage_summary");
  if (error)
    return Response.json(
      {
        error:
          "Plan usage is unavailable. Please contact support if this continues.",
      },
      { status: 503 },
    );
  // The summary has no prices, and seats bought before the November 2026 price change
  // renew at ₹500, so read each subscription's stored amount to show the real bill.
  const service = supabase(undefined, true);
  const { data: member } = await service
    .from("crm_members")
    .select("organization_id")
    .eq("id", auth.member.id)
    .single();
  if (member) {
    const [{ data: base }, { data: seats }] = await Promise.all([
      service
        .from("crm_billing_subscriptions")
        .select("plan,billing_months,amount_paise,status")
        .eq("organization_id", member.organization_id)
        .maybeSingle(),
      service
        .from("crm_seat_subscriptions")
        .select("id,unit_paise")
        .eq("organization_id", member.organization_id),
    ]);
    if (base) data.billing = base;
    const unit = new Map((seats ?? []).map((s) => [s.id, s.unit_paise]));
    for (const seat of data.seat_subscriptions ?? [])
      seat.unit_paise = unit.get(seat.id) ?? null;
  }
  return Response.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
