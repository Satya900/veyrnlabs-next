import { session, sameOrigin, jsonBody, supabase } from "@/lib/crm/server";
import {
  connectWhatsApp,
  embeddedSignupReady,
  encryptWhatsAppToken,
} from "@/lib/crm/whatsapp-connect";
export const maxDuration = 60;
export async function GET() {
  const auth = await session();
  if (!auth || auth.member.role === "team")
    return Response.json({ error: "Admin access required." }, { status: 403 });
  const { data, error } = await auth.db
    .from("crm_whatsapp_connections")
    .select("display_phone,active")
    .maybeSingle();
  if (error)
    return Response.json(
      { error: "Apply the WhatsApp migration first." },
      { status: 503 },
    );
  return Response.json(
    {
      ready: embeddedSignupReady(process.env),
      appId: process.env.META_APP_ID,
      configId: process.env.META_WHATSAPP_CONFIG_ID,
      version: process.env.META_GRAPH_VERSION || "v25.0",
      connection: data,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid origin." }, { status: 403 });
  const auth = await session();
  if (!auth || auth.member.role !== "owner")
    return Response.json(
      { error: "Only the owner connects WhatsApp." },
      { status: 403 },
    );
  try {
    const body = await jsonBody(request, 8000);
    if (body.action === "disconnect") {
      const { error } = await auth.db.rpc("crm_disconnect_whatsapp");
      if (error) throw new Error("Could not disconnect.");
      return Response.json({ ok: true });
    }
    if (
      typeof body.code !== "string" ||
      typeof body.waba !== "string" ||
      typeof body.phone !== "string"
    )
      throw new Error("Complete the Meta signup first.");
    const { data: existing } = await auth.db
      .from("crm_whatsapp_connections")
      .select("phone_number_id")
      .maybeSingle();
    if (existing && existing.phone_number_id !== body.phone)
      throw new Error(
        "A different number is linked. Contact support to migrate your history.",
      );
    const result = await connectWhatsApp(process.env, {
      code: body.code,
      waba: body.waba,
      phone: body.phone,
      pin: typeof body.pin === "string" ? body.pin : undefined,
    });
    const { error } = await supabase(undefined, true).rpc(
      "crm_save_whatsapp_connection",
      {
        actor: auth.member.id,
        waba: body.waba,
        phone: body.phone,
        display_number: result.displayPhone,
        encrypted_token: encryptWhatsAppToken(process.env, result.token),
        expires: result.expiresAt,
      },
    );
    if (error)
      throw new Error(
        "Number connection could not be saved. It may belong to another workspace.",
      );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Connection failed." },
      { status: 400 },
    );
  }
}
