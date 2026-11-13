import { randomBytes } from "node:crypto";
import { session, sameOrigin, jsonBody, supabase } from "@/lib/crm/server";
import { sendGupshupText } from "@/lib/crm/whatsapp-gupshup";
import { tenantSendConfig } from "@/lib/crm/whatsapp-tenant";
import {
  connectWhatsApp,
  embeddedSignupReady,
  encryptWhatsAppToken,
} from "@/lib/crm/whatsapp-connect";
export const maxDuration = 60;
export async function GET(request: Request) {
  const auth = await session();
  if (!auth || auth.member.role === "team")
    return Response.json({ error: "Admin access required." }, { status: 403 });
  const { data, error } = await auth.db
    .from("crm_whatsapp_connections")
    .select("display_phone,active,provider,provider_app,provider_app_id")
    .maybeSingle();
  // The callback URL embeds the webhook's only credential, so only the owner sees it.
  let callbackUrl: string | null = null;
  if (auth.member.role === "owner" && data?.provider === "gupshup") {
    const { data: secret } = await supabase(undefined, true)
      .from("crm_whatsapp_connections")
      .select("callback_token")
      .eq("organization_id", auth.organizationId)
      .maybeSingle();
    if (secret?.callback_token)
      callbackUrl = `https://${request.headers.get("host")}/api/webhooks/gupshup/${secret.callback_token}`;
  }
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
      callbackUrl,
      gupshupReady: /^[a-f0-9]{64}$/i.test(process.env.CRM_WHATSAPP_TOKEN_KEY ?? ""),
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
    if (body.action === "gupshup") {
      const app = typeof body.app === "string" ? body.app.trim() : "";
      const phone = typeof body.phone === "string" ? body.phone.replace(/[\s+()-]/g, "") : "";
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (!/^[A-Za-z0-9_.-]{1,100}$/.test(app))
        throw new Error("Enter your Gupshup app name exactly as it appears in Gupshup.");
      if (!/^\d{8,15}$/.test(phone))
        throw new Error("Enter the WhatsApp number with country code, for example 919876543210.");
      if (apiKey.length < 8 || apiKey.length > 200)
        throw new Error("Paste the API key from your Gupshup app.");
      let encrypted: string;
      try {
        encrypted = encryptWhatsAppToken(process.env, apiKey);
      } catch {
        throw new Error("WhatsApp connections aren't enabled on this server yet.");
      }
      const { error } = await supabase(undefined, true).rpc("crm_save_gupshup_connection", {
        actor: auth.member.id,
        app,
        phone,
        display_number: `+${phone}`,
        encrypted_key: encrypted,
        token: randomBytes(32).toString("hex"),
      });
      if (error)
        throw new Error(
          error.message.includes("different number")
            ? "A different number is connected. Disconnect it first."
            : "The connection couldn't be saved. The number may belong to another workspace.",
        );
      return Response.json({ ok: true });
    }
    if (body.action === "gupshupAppId") {
      // Only the app's ID; it identifies the app but can't send anything on its own.
      const appId = typeof body.appId === "string" ? body.appId.trim().toLowerCase() : "";
      if (appId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(appId))
        throw new Error("Paste the App ID from Gupshup. It looks like 1b73dad6-1234-5678-9abc-60981da19f70.");
      const { data, error } = await supabase(undefined, true)
        .from("crm_whatsapp_connections")
        .update({ provider_app_id: appId || null })
        .eq("organization_id", auth.organizationId)
        .eq("provider", "gupshup")
        .select("id");
      if (error) throw new Error("Couldn't save the App ID. Apply the latest migration.");
      if (!data.length) throw new Error("Connect your Gupshup app first.");
      return Response.json({
        ok: true,
        message: appId
          ? "Saved. Customers now see blue ticks as soon as the AI starts replying."
          : "App ID removed. Blue ticks are off.",
      });
    }
    if (body.action === "gupshupTest") {
      const to = typeof body.to === "string" ? body.to.replace(/[\s+()-]/g, "") : "";
      if (!/^\d{7,15}$/.test(to))
        throw new Error("Enter the number to message, with country code.");
      const config = await tenantSendConfig(auth.member.id);
      if (!config || config.provider !== "gupshup")
        throw new Error(
          "Sending isn't available. Check the Gupshup connection, your plan's messaging allowance and that WhatsApp sending is enabled.",
        );
      const result = await sendGupshupText(
        config.token,
        config.app,
        config.phone,
        to,
        "This is a test message from Veyrn CRM. Your WhatsApp connection is working.",
      );
      if (result.status === "accepted")
        return Response.json({ ok: true, message: "Test message sent. Check WhatsApp on that phone." });
      throw new Error(
        result.status === "rejected"
          ? "Gupshup rejected the message. Check the app name, number and API key, and that the recipient has messaged your number in the last 24 hours."
          : "Gupshup didn't confirm the message. Check WhatsApp before trying again.",
      );
    }
    if (
      typeof body.code !== "string" ||
      typeof body.waba !== "string" ||
      typeof body.phone !== "string"
    )
      throw new Error("Complete the Meta signup first.");
    const { data: existing } = await auth.db
      .from("crm_whatsapp_connections")
      .select("phone_number_id,active")
      .maybeSingle();
    if (existing?.active && existing.phone_number_id !== body.phone)
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
