import { session } from "@/lib/crm/server";

const headers = { "Cache-Control": "private, no-store" };

/** Public-page-safe: tells the marketing pricing cards what to show, without exposing
 * costs, revenue or any data beyond what a visitor is already about to decide from. */
export async function GET() {
  const auth = await session();
  if (!auth) return Response.json({ signedIn: false }, { headers });
  if (auth.member.role === "team")
    return Response.json({ signedIn: true, canManageBilling: false }, { headers });
  const { data, error } = await auth.db.rpc("crm_usage_summary");
  if (error)
    return Response.json({ signedIn: true, canManageBilling: true }, { headers });
  return Response.json(
    {
      signedIn: true,
      canManageBilling: true,
      status: data.status,
      plan: data.plan ?? null,
      billingMonths: data.billing_months ?? null,
    },
    { headers },
  );
}
