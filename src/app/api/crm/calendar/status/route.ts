import { sameOrigin, session } from "@/lib/crm/server";

export async function GET() {
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const { data, error } = await auth.db.rpc("crm_calendar_status");
  if (error)
    return Response.json({ error: "Calendar status unavailable." }, { status: 503 });
  return Response.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const { error } = await auth.db.rpc("crm_disconnect_calendar");
  if (error)
    return Response.json({ error: "Could not disconnect your calendar." }, { status: 400 });
  return Response.json({ ok: true });
}
