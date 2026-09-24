import { supabase } from "@/lib/crm/server";
import { whatsappReceiverConfigured } from "@/lib/crm/whatsapp-config";
import {
  parseWhatsAppMessages,
  parseWhatsAppReceipts,
  readWebhookBody,
  verifyWhatsAppChallenge,
  verifyWhatsAppSignature,
} from "@/lib/crm/whatsapp-webhook";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!whatsappReceiverConfigured(process.env))
    return new Response("Webhook unavailable", { status: 503 });
  const challenge = verifyWhatsAppChallenge(
    new URL(request.url),
    process.env.WHATSAPP_VERIFY_TOKEN!,
  );
  return new Response(challenge ?? "Verification failed", {
    status: challenge ? 200 : 403,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!whatsappReceiverConfigured(process.env))
    return new Response("Webhook unavailable", { status: 503 });
  let raw: Uint8Array;
  try {
    raw = await readWebhookBody(request);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  if (
    !verifyWhatsAppSignature(
      raw,
      request.headers.get("x-hub-signature-256"),
      process.env.WHATSAPP_APP_SECRET!,
    )
  )
    return new Response("Invalid signature", { status: 401 });
  let events, receipts;
  try {
    const payload = JSON.parse(Buffer.from(raw).toString("utf8"));
    events = parseWhatsAppMessages(payload);
    receipts = parseWhatsAppReceipts(payload);
  } catch {
    return new Response("Invalid event", { status: 400 });
  }
  const db = supabase(undefined, true);
  if (receipts.length) {
    const { error } = await db.rpc("crm_receive_whatsapp_receipts", {
      events: receipts,
    });
    if (error) return new Response("Please retry receipts", { status: 503 });
  }
  if (!events.length) return Response.json({ received: true });
  // Single transaction: acknowledge only after storage succeeds. Meta retries are deduplicated in SQL.
  const { error } = await db.rpc("crm_receive_whatsapp", { events });
  if (error) return new Response("Please retry delivery", { status: 503 });
  return Response.json({ received: true });
}
