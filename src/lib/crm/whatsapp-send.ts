import { sendGupshupMedia, sendGupshupText, type MediaMessage } from "./whatsapp-gupshup.ts";

export type SendConfig = NonNullable<ReturnType<typeof sendConfig>>;
export function sendConfig(env: Record<string, string | undefined>) {
  const cost = Number(env.WHATSAPP_REPLY_COST_PAISE);
  const provider = env.WHATSAPP_SEND_PROVIDER === "gupshup" ? "gupshup" : "meta";
  if (
    provider === "gupshup" &&
    !/^[A-Za-z0-9_.-]{1,100}$/.test(env.WHATSAPP_SEND_APP ?? "")
  )
    return null;
  if (
    env.WHATSAPP_SEND_ENABLED !== "true" ||
    !env.WHATSAPP_ACCESS_TOKEN?.trim() ||
    !/^[0-9a-f-]{36}$/i.test(env.WHATSAPP_SEND_ORGANIZATION_ID ?? "") ||
    !/^\d+$/.test(env.WHATSAPP_SEND_PHONE_ID ?? "") ||
    !/^\d+$/.test(env.WHATSAPP_SEND_WABA_ID ?? "") ||
    !Number.isSafeInteger(cost) ||
    cost < 1 ||
    cost > 10000
  )
    return null;
  return {
    token: env.WHATSAPP_ACCESS_TOKEN,
    org: env.WHATSAPP_SEND_ORGANIZATION_ID!,
    phone: env.WHATSAPP_SEND_PHONE_ID!,
    waba: env.WHATSAPP_SEND_WABA_ID!,
    cost,
    provider,
    app: env.WHATSAPP_SEND_APP ?? "",
  } as const;
}

/** Sends a text reply through whichever provider the workspace connected. */
export function sendReply(
  send: Pick<SendConfig, "provider" | "token" | "app">,
  phone: string,
  recipient: string,
  body: string,
  request: typeof fetch = fetch,
) {
  return send.provider === "gupshup"
    ? sendGupshupText(send.token, send.app, phone, recipient, body, request)
    : sendWhatsAppReply(send.token, phone, recipient, body, request);
}
/** Sends a brochure or image by link through whichever provider the workspace connected. */
export function sendMedia(
  send: Pick<SendConfig, "provider" | "token" | "app">,
  phone: string,
  recipient: string,
  media: MediaMessage,
  request: typeof fetch = fetch,
) {
  return send.provider === "gupshup"
    ? sendGupshupMedia(send.token, send.app, phone, recipient, media, request)
    : sendWhatsAppMedia(send.token, phone, recipient, media, request);
}
export type SendResult = {
  status: "accepted" | "rejected" | "unknown";
  messageId: string | null;
};
export async function sendWhatsAppReply(
  token: string,
  phone: string,
  recipient: string,
  body: string,
  request: typeof fetch = fetch,
): Promise<SendResult> {
  if (
    !/^\d+$/.test(phone) ||
    !/^\d{7,15}$/.test(recipient) ||
    !body.trim() ||
    body.length > 3000
  )
    throw new Error("Invalid reply");
  try {
    const response = await request(
      `https://graph.facebook.com/v25.0/${phone}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          type: "text",
          text: { preview_url: false, body },
        }),
      },
    );
    const data = await response.json();
    const id = data.messages?.[0]?.id;
    if (
      response.ok &&
      typeof id === "string" &&
      id.length > 0 &&
      id.length <= 500 &&
      !data.error
    )
      return { status: "accepted", messageId: id };
    // Only explicit Meta client errors are confirmed rejections; ambiguous outcomes never auto-retry.
    if (
      response.status >= 400 &&
      response.status < 500 &&
      Number.isInteger(data.error?.code)
    )
      return { status: "rejected", messageId: null };
  } catch {
    /* A timeout can happen after Meta accepts a message. */
  }
  return { status: "unknown", messageId: null };
}

export async function sendWhatsAppMedia(
  token: string,
  phone: string,
  recipient: string,
  media: MediaMessage,
  request: typeof fetch = fetch,
): Promise<SendResult> {
  if (!/^\d+$/.test(phone) || !/^\d{7,15}$/.test(recipient) || !/^https:\/\/\S{1,1000}$/.test(media.url))
    throw new Error("Invalid file message");
  try {
    const response = await request(`https://graph.facebook.com/v25.0/${phone}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        ...(media.image
          ? { type: "image", image: { link: media.url, caption: media.caption } }
          : { type: "document", document: { link: media.url, filename: media.filename, caption: media.caption } }),
      }),
    });
    const data = await response.json();
    const id = data.messages?.[0]?.id;
    if (response.ok && typeof id === "string" && id.length > 0 && id.length <= 500 && !data.error)
      return { status: "accepted", messageId: id };
    if (response.status >= 400 && response.status < 500 && Number.isInteger(data.error?.code))
      return { status: "rejected", messageId: null };
  } catch {
    /* A timeout can happen after Meta accepts a message. */
  }
  return { status: "unknown", messageId: null };
}
