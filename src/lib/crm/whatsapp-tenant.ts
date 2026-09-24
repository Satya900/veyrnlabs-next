import "server-only";
import { supabase } from "./server";
import { sendConfig } from "./whatsapp-send";
import { decryptWhatsAppToken } from "./whatsapp-connect";

export async function tenantSendConfig(
  memberId?: string,
  organizationId?: string,
) {
  const db = supabase(undefined, true);
  let org = organizationId;
  if (memberId) {
    const { data } = await db
      .from("crm_members")
      .select("organization_id")
      .eq("id", memberId)
      .single();
    org = data?.organization_id;
  }
  if (!org) return null;
  const { data: connection } = await db
    .from("crm_whatsapp_connections")
    .select("active,phone_number_id,waba_id")
    .eq("organization_id", org)
    .maybeSingle();
  if (!connection?.active) return null;
  const { data: credential, error } = await db
    .from("crm_whatsapp_credentials")
    .select("token_encrypted,expires_at")
    .eq("organization_id", org)
    .maybeSingle();
  if (error) return null;
  if (credential) {
    if (
      credential.expires_at &&
      Date.parse(credential.expires_at) <= Date.now()
    )
      return null;
    try {
      return sendConfig({
        ...process.env,
        WHATSAPP_ACCESS_TOKEN: decryptWhatsAppToken(
          process.env,
          credential.token_encrypted,
        ),
        WHATSAPP_SEND_ORGANIZATION_ID: org,
        WHATSAPP_SEND_PHONE_ID: connection.phone_number_id,
        WHATSAPP_SEND_WABA_ID: connection.waba_id,
      });
    } catch {
      return null;
    }
  }
  const legacy = sendConfig(process.env);
  return legacy?.org === org &&
    legacy.phone === connection.phone_number_id &&
    legacy.waba === connection.waba_id
    ? legacy
    : null;
}
