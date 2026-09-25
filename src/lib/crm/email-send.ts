export function emailConfig(env: Record<string, string | undefined>) {
  const cost = Number(env.EMAIL_REPLY_COST_PAISE);
  if (
    env.EMAIL_SEND_ENABLED !== "true" ||
    !env.RESEND_API_KEY?.trim() ||
    !env.CRM_FOLLOWUP_FROM_EMAIL?.trim() ||
    !Number.isSafeInteger(cost) ||
    cost < 1 ||
    cost > 10000
  )
    return null;
  return {
    key: env.RESEND_API_KEY,
    from: env.CRM_FOLLOWUP_FROM_EMAIL,
    cost,
  };
}
export type SendResult = {
  status: "accepted" | "rejected" | "unknown";
  messageId: string | null;
};
export async function sendFollowUpEmail(
  key: string,
  from: string,
  recipient: string,
  subject: string,
  body: string,
  request: typeof fetch = fetch,
): Promise<SendResult> {
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ||
    !subject.trim() ||
    subject.length > 200 ||
    !body.trim() ||
    body.length > 4000
  )
    throw new Error("Invalid email reply");
  try {
    const response = await request("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ from, to: recipient, subject, text: body }),
    });
    const data = await response.json();
    if (response.ok && typeof data.id === "string" && data.id.length > 0)
      return { status: "accepted", messageId: data.id };
    if (response.status >= 400 && response.status < 500)
      return { status: "rejected", messageId: null };
  } catch {
    /* A timeout can happen after Resend accepts the message. */
  }
  return { status: "unknown", messageId: null };
}
