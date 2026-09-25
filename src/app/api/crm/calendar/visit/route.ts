import { session } from "@/lib/crm/server";

export async function GET(request: Request) {
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const leadId = new URL(request.url).searchParams.get("leadId") || "";
  if (!/^[a-f0-9-]{36}$/i.test(leadId))
    return Response.json({ error: "Invalid lead." }, { status: 400 });
  const { data, error } = await auth.db.rpc("crm_lead_visit", { lead: leadId });
  if (error)
    return Response.json({ error: "Could not load this visit." }, { status: 400 });
  return Response.json(
    { visit: data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
