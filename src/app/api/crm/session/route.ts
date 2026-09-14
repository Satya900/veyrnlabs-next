import { cookies } from "next/headers";
import {
  configured,
  cookieName,
  jsonBody,
  sameOrigin,
  supabase,
} from "@/lib/crm/server";

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (!configured())
    return Response.json(
      { error: "Connect Supabase before signing in." },
      { status: 503 },
    );
  try {
    const body = await jsonBody(request, 4000);
    if (
      typeof body.email !== "string" ||
      typeof body.password !== "string" ||
      body.password.length > 1000
    )
      throw new Error("Enter your email and password.");
    const db = supabase();
    const { data, error } = await db.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });
    if (error || !data.session)
      return Response.json(
        {
          error:
            "Unable to sign in. Check your credentials or try again later.",
        },
        { status: 401 },
      );
    const { data: member } = await supabase(data.session.access_token)
      .from("crm_members")
      .select("id")
      .eq("id", data.user.id)
      .single();
    if (!member)
      return Response.json(
        { error: "Your account has not been added to this workspace." },
        { status: 403 },
      );
    (await cookies()).set(cookieName, data.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: data.session.expires_in,
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Unable to sign in. Check your details and connection." },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  (await cookies()).delete(cookieName);
  return Response.json({ ok: true });
}
