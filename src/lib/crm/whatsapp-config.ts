/** Return readiness only; never serialize environment values into the customer response. */
export function whatsappReceiverConfigured(
  env: Record<string, string | undefined>,
) {
  return (
    env.WHATSAPP_WEBHOOK_ENABLED === "true" &&
    [
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.WHATSAPP_APP_SECRET,
      env.WHATSAPP_VERIFY_TOKEN,
    ].every((value) => Boolean(value?.trim()))
  );
}
