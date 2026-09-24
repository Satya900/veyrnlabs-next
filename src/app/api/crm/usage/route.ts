import { session } from "@/lib/crm/server";

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
  return Response.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
