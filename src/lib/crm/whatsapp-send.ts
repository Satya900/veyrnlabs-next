export function sendConfig(env: Record<string, string | undefined>) {
  const cost = Number(env.WHATSAPP_REPLY_COST_PAISE);
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
  };
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
