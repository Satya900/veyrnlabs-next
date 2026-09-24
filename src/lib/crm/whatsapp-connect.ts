import {
  decryptCalendarToken,
  encryptCalendarToken,
} from "./calendar-crypto.ts";
type Env = Record<string, string | undefined>;
export function embeddedSignupReady(env: Env) {
  return Boolean(
    env.META_APP_ID &&
    env.META_WHATSAPP_CONFIG_ID &&
    env.WHATSAPP_APP_SECRET &&
    /^[a-f0-9]{64}$/i.test(env.CRM_WHATSAPP_TOKEN_KEY ?? ""),
  );
}
export function encryptWhatsAppToken(env: Env, token: string) {
  return encryptCalendarToken(
    { CRM_CALENDAR_TOKEN_KEY: env.CRM_WHATSAPP_TOKEN_KEY },
    token,
  );
}
export function decryptWhatsAppToken(env: Env, token: string) {
  return decryptCalendarToken(
    { CRM_CALENDAR_TOKEN_KEY: env.CRM_WHATSAPP_TOKEN_KEY },
    token,
  );
}

export async function connectWhatsApp(
  env: Env,
  input: { code: string; waba: string; phone: string; pin?: string },
  request: typeof fetch = fetch,
) {
  if (
    !embeddedSignupReady(env) ||
    !input.code ||
    input.code.length > 4096 ||
    !/^\d{1,30}$/.test(input.waba) ||
    !/^\d{1,30}$/.test(input.phone) ||
    (input.pin && !/^\d{6}$/.test(input.pin))
  )
    throw new Error("Invalid WhatsApp connection details.");
  const graph = `https://graph.facebook.com/${env.META_GRAPH_VERSION || "v25.0"}`;
  async function api(path: string, token: string, body?: unknown) {
    const response = await request(`${graph}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || data.error)
      throw new Error(
        "Meta could not verify or connect this number. Check its permissions and registration, then reconnect.",
      );
    return data;
  }
  const params = new URLSearchParams({
    client_id: env.META_APP_ID!,
    client_secret: env.WHATSAPP_APP_SECRET!,
    code: input.code,
  });
  const response = await request(`${graph}/oauth/access_token?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || typeof result.access_token !== "string")
    throw new Error("Meta authorization expired. Start connecting again.");
  const token = result.access_token as string;
  const debug = await api(
    `debug_token?input_token=${encodeURIComponent(token)}`,
    `${env.META_APP_ID}|${env.WHATSAPP_APP_SECRET}`,
  );
  if (
    !debug.data?.is_valid ||
    String(debug.data.app_id) !== env.META_APP_ID ||
    !debug.data.scopes?.includes("whatsapp_business_messaging") ||
    !debug.data.scopes?.includes("whatsapp_business_management")
  )
    throw new Error(
      "The WhatsApp permissions are incomplete. Authorize both messaging and management.",
    );
  // Meta's response, not client-supplied identifiers, establishes the WABA/phone relationship.
  const phones = await api(
    `${input.waba}/phone_numbers?fields=id,display_phone_number&limit=100`,
    token,
  );
  const phone = phones.data?.find((p: { id: string }) => p.id === input.phone);
  if (!phone || typeof phone.display_phone_number !== "string")
    throw new Error(
      "This phone number was not shared by the authorized business.",
    );
  if (input.pin)
    await api(`${input.phone}/register`, token, {
      messaging_product: "whatsapp",
      pin: input.pin,
    });
  await api(`${input.waba}/subscribed_apps`, token, {});
  const expiry = [
    debug.data.expires_at,
    debug.data.data_access_expires_at,
  ].filter((v): v is number => typeof v === "number" && v > 0);
  return {
    token,
    displayPhone: phone.display_phone_number as string,
    expiresAt: expiry.length
      ? new Date(Math.min(...expiry) * 1000).toISOString()
      : null,
  };
}
