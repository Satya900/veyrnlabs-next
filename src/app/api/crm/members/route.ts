import { jsonBody, sameOrigin, session } from "@/lib/crm/server";

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    const body = await jsonBody(request, 2000);
    if (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/i.test(body.id))
      throw new Error("Invalid member.");
    if (body.action === "remove") {
      const { error } = await auth.db.rpc("crm_remove_member", {
        target: body.id,
      });
      if (error)
        throw new Error(
          "Unable to remove this member. Check their role and whether they are the owner.",
        );
      return Response.json({ ok: true });
    }
    if (body.action === "transfer") {
      const { error } = await auth.db.rpc("crm_transfer_ownership", {
        new_owner: body.id,
      });
      if (error)
        throw new Error("Unable to transfer ownership to this member.");
      return Response.json({ ok: true });
    }
    throw new Error("Unknown action.");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 400 },
    );
  }
}
