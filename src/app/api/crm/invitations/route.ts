import { randomBytes } from "node:crypto";
import { accountsEnabled, hashInvitation } from "@/lib/crm/accounts";
import { jsonBody, sameOrigin, session } from "@/lib/crm/server";
import { accountFields } from "@/lib/crm/account-validation";

export async function GET() {
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (auth.member.role === "team")
    return Response.json(
      { error: "Only owners and admins manage invitations." },
      { status: 403 },
    );
  const { data, error } = await auth.db
    .from("crm_invitations")
    .select("id,email,role,created_at,expires_at,accepted_at,revoked_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error)
    return Response.json(
      {
        error:
          "Invitations are unavailable. Check that the account migration has been applied.",
      },
      { status: 503 },
    );
  return Response.json(
    { invitations: data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (!accountsEnabled())
    return Response.json(
      { error: "Team onboarding is not enabled yet." },
      { status: 503 },
    );
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (auth.member.role === "team")
    return Response.json(
      { error: "Only owners and admins manage invitations." },
      { status: 403 },
    );
  try {
    const body = await jsonBody(request, 2000);
    if (body.action === "revoke") {
      if (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/i.test(body.id))
        throw new Error("Invalid invitation.");
      const { error } = await auth.db.rpc("crm_revoke_invitation", {
        invitation: body.id,
      });
      if (error) throw new Error("Unable to revoke this invitation.");
      return Response.json({ ok: true });
    }
    if (body.action !== "create") throw new Error("Unknown action.");
    const { email } = accountFields(body);
    if (
      !["admin", "team"].includes(String(body.role)) ||
      (auth.member.role === "admin" && body.role !== "team")
    )
      throw new Error("You cannot invite this role.");
    const token = randomBytes(32).toString("hex");
    const { error } = await auth.db.rpc("crm_create_invitation", {
      invite_email: email,
      invite_role: body.role,
      hashed_token: hashInvitation(token),
    });
    if (error)
      throw new Error(
        "Could not create an invitation. Check setup or try again later.",
      );
    // Relative URL is resolved by the browser to its current trusted origin.
    return Response.json(
      { ok: true, path: `/crm/join#${token}` },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invitation failed." },
      { status: 400 },
    );
  }
}
