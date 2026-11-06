// Gupshup self-serve WhatsApp API. No environment reads: callers pass the workspace's own
// app name, number and API key, so tests can inject `request`.
// Docs: https://docs.gupshup.io/reference/session-text-message (send),
// https://docs.gupshup.io/docs/what-is-an-inbound-message (inbound),
// https://docs.gupshup.io/docs/message-events (delivery events).
import type { SendResult } from "./whatsapp-send.ts";
import type { WhatsAppInbound, WhatsAppReceipt } from "./whatsapp-webhook.ts";

const API = "https://api.gupshup.io/wa/api/v1";
// Gupshup numbers are stored as connections with this WhatsApp account id (see migration).
export const GUPSHUP_WABA_ID = "0";

export async function sendGupshupText(
  apiKey: string,
  app: string,
  source: string,
  recipient: string,
  body: string,
  request: typeof fetch = fetch,
): Promise<SendResult> {
  if (
    !apiKey.trim() ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(app) ||
    !/^\d{8,15}$/.test(source) ||
    !/^\d{7,15}$/.test(recipient) ||
    !body.trim() ||
    body.length > 3000
  )
    throw new Error("Invalid reply");
  try {
    const response = await request(`${API}/msg`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: AbortSignal.timeout(20000),
      body: new URLSearchParams({
        channel: "whatsapp",
        source,
        destination: recipient,
        "src.name": app,
        message: JSON.stringify({ type: "text", text: body }),
      }),
    });
    const data = await response.json().catch(() => ({}));
    const id = data?.messageId;
    if (
      response.ok &&
      data?.status === "submitted" &&
      typeof id === "string" &&
      id.length > 0 &&
      id.length <= 500
    )
      return { status: "accepted", messageId: id };
    // Gupshup answers a bad key, app or number with a 4xx and status "error": nothing was sent.
    if (response.status >= 400 && response.status < 500 && data?.status === "error")
      return { status: "rejected", messageId: null };
  } catch {
    /* A timeout can happen after Gupshup accepts a message. */
  }
  return { status: "unknown", messageId: null };
}

const object = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";
function timestamp(value: unknown) {
  // Inbound timestamps are milliseconds; delivery events use seconds.
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

/**
 * Converts one Gupshup callback into the events the WhatsApp tables already store. Unknown
 * or informational callbacks (user events, connectivity checks, "enqueued") yield nothing.
 */
export function parseGupshupCallback(
  payload: unknown,
  phone: string,
): { events: WhatsAppInbound[]; receipts: WhatsAppReceipt[] } {
  const root = object(payload);
  const inner = object(root.payload);
  const events: WhatsAppInbound[] = [];
  const receipts: WhatsAppReceipt[] = [];
  if (root.type === "message") {
    const sender = object(inner.sender);
    const from = text(sender.phone ?? inner.source, 20);
    const id = text(inner.id, 300);
    if (!/^\d{5,20}$/.test(from) || !/^\S{1,300}$/.test(id))
      throw new Error("Invalid Gupshup message");
    const type = text(inner.type, 40) || "unknown";
    const content = object(inner.payload);
    const body =
      type === "text"
        ? text(content.text, 4096)
        : type === "button_reply" || type === "list_reply" || type === "quick_reply"
          ? text(content.title ?? content.text, 4096)
          : text(content.caption, 4096);
    if (type === "text" && !body) throw new Error("Invalid Gupshup text");
    events.push({
      waba_id: GUPSHUP_WABA_ID,
      phone_number_id: phone,
      message_id: id,
      sender: from,
      contact_name: text(sender.name, 200),
      message_type: /^[a-z_]{1,40}$/.test(type) ? type : "unknown",
      body,
      sent_at: timestamp(root.timestamp),
    });
  } else if (root.type === "message-event") {
    const status = text(inner.type, 20);
    if (["sent", "delivered", "read", "failed"].includes(status)) {
      // We store Gupshup's own message id (returned when sending); delivery events carry it
      // as gsId, and failed events as id.
      const id = text(status === "failed" ? (inner.gsId ?? inner.id) : inner.gsId, 300);
      const event = object(inner.payload);
      const recipient = text(inner.destination, 20);
      // Receipts are matched to a conversation by recipient; skip any that lack one.
      if (id && /^\d{5,20}$/.test(recipient))
        receipts.push({
          waba_id: GUPSHUP_WABA_ID,
          phone_number_id: phone,
          message_id: id,
          recipient,
          status: status as WhatsAppReceipt["status"],
          occurred_at: timestamp(event.ts ?? root.timestamp),
          error_code:
            Number.isInteger(Number(event.code)) && Number(event.code) >= 0
              ? Number(event.code)
              : null,
        });
    }
  }
  return { events, receipts };
}
