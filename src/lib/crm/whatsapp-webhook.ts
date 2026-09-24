import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWhatsAppSignature(
  raw: Uint8Array,
  signature: string | null,
  secret: string,
) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

export function verifyWhatsAppChallenge(url: URL, token: string) {
  const supplied = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (
    !token ||
    supplied.length > 1000 ||
    url.searchParams.get("hub.mode") !== "subscribe" ||
    !/^\d{1,100}$/.test(challenge)
  )
    return null;
  const a = Buffer.from(token),
    b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}

export async function readWebhookBody(request: Request, limit = 1_048_576) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("Expected JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Payload too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
function required(value: unknown, pattern: RegExp) {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error("Invalid WhatsApp event");
  return value;
}
export type WhatsAppInbound = {
  waba_id: string;
  phone_number_id: string;
  message_id: string;
  sender: string;
  contact_name: string;
  message_type: string;
  body: string;
  sent_at: string;
};

export type WhatsAppReceipt = {
  waba_id: string;
  phone_number_id: string;
  message_id: string;
  recipient: string;
  status: "sent" | "delivered" | "read" | "failed";
  occurred_at: string;
  error_code: number | null;
};
export function parseWhatsAppReceipts(payload: unknown): WhatsAppReceipt[] {
  const root = object(payload);
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry))
    throw new Error("Invalid WhatsApp object");
  const receipts: WhatsAppReceipt[] = [];
  for (const rawEntry of root.entry) {
    const entry = object(rawEntry);
    for (const rawChange of list(entry.changes)) {
      const change = object(rawChange),
        value = object(change.value);
      if (change.field !== "messages") continue;
      if (value.statuses !== undefined && !Array.isArray(value.statuses))
        throw new Error("Invalid statuses");
      for (const rawStatus of list(value.statuses)) {
        if (receipts.length >= 500) throw new Error("Too many receipts");
        const status = object(rawStatus);
        if (
          !["sent", "delivered", "read", "failed"].includes(
            String(status.status),
          )
        )
          continue;
        const timestamp = Number(required(status.timestamp, /^\d{1,12}$/));
        if (!Number.isSafeInteger(timestamp) || timestamp > 253402300799)
          throw new Error("Invalid timestamp");
        const code = object(list(status.errors)[0]).code;
        receipts.push({
          waba_id: required(entry.id, /^\d{1,30}$/),
          phone_number_id: required(
            object(value.metadata).phone_number_id,
            /^\d{1,30}$/,
          ),
          message_id: required(status.id, /^\S{1,500}$/),
          recipient: required(status.recipient_id, /^\d{5,20}$/),
          status: status.status as WhatsAppReceipt["status"],
          occurred_at: new Date(timestamp * 1000).toISOString(),
          error_code:
            typeof code === "number" &&
            Number.isSafeInteger(code) &&
            code >= 0 &&
            code <= 2147483647
              ? code
              : null,
        });
      }
    }
  }
  return receipts;
}

/** Normalize only inbound messages. Delivery statuses never create leads or consume reply usage. */
export function parseWhatsAppMessages(payload: unknown): WhatsAppInbound[] {
  const root = object(payload);
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry))
    throw new Error("Invalid WhatsApp object");
  const events: WhatsAppInbound[] = [];
  for (const rawEntry of root.entry) {
    const entry = object(rawEntry);
    for (const rawChange of list(entry.changes)) {
      const change = object(rawChange),
        value = object(change.value);
      if (change.field !== "messages") continue;
      if (value.messages !== undefined && !Array.isArray(value.messages))
        throw new Error("Invalid messages");
      for (const rawMessage of list(value.messages)) {
        if (events.length >= 500) throw new Error("Too many messages");
        const message = object(rawMessage);
        const sender = required(message.from, /^\d{5,20}$/);
        const timestamp = Number(required(message.timestamp, /^\d{1,12}$/));
        if (!Number.isSafeInteger(timestamp) || timestamp > 253402300799)
          throw new Error("Invalid timestamp");
        const type = required(message.type, /^[a-z_]{1,40}$/);
        const contact = list(value.contacts)
          .map(object)
          .find((item) => item.wa_id === sender);
        const name = object(contact?.profile).name;
        let body: unknown = "";
        if (type === "text") {
          body = object(message.text).body;
          if (typeof body !== "string" || !body.length || body.length > 4096)
            throw new Error("Invalid text message");
        } else if (type === "button") body = object(message.button).text;
        else if (type === "interactive") {
          const interactive = object(message.interactive);
          body =
            object(interactive.button_reply).title ??
            object(interactive.list_reply).title;
        } else body = object(message[type]).caption;
        events.push({
          waba_id: required(entry.id, /^\d{1,30}$/),
          phone_number_id: required(
            object(value.metadata).phone_number_id,
            /^\d{1,30}$/,
          ),
          message_id: required(message.id, /^\S{1,300}$/),
          sender,
          contact_name: typeof name === "string" ? name.slice(0, 200) : "",
          message_type: type,
          body: typeof body === "string" ? body.slice(0, 4096) : "",
          sent_at: new Date(timestamp * 1000).toISOString(),
        });
      }
    }
  }
  return events;
}
