import { sendGupshupTemplate } from "./whatsapp-gupshup.ts";
import type { SendConfig } from "./whatsapp-send.ts";

type RPC = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Claim =
  | { job: string; run: false; skipped?: boolean }
  | {
      job: string;
      token: string;
      run: true;
      outbox: string;
      organization: string;
      recipient: string;
      phone: string;
      template: string;
      params: string[];
    };

/**
 * Sends at most one due WhatsApp follow-up, or with crm_claim_lead_welcome one welcome
 * message to a newly captured lead. The database decides what is due and renders the
 * template; this sends it from the workspace's own connection and records the outcome. An
 * uncertain provider outcome is never retried automatically.
 */
export async function processWhatsAppFollowUp(
  costPaise: number,
  rpc: RPC,
  sendConfigFor: (organization: string) => Promise<SendConfig | null>,
  request: typeof fetch = fetch,
  claimFunction: "crm_claim_whatsapp_followup" | "crm_claim_lead_welcome" = "crm_claim_whatsapp_followup",
) {
  async function call(name: string, args: Record<string, unknown>) {
    const result = await rpc(name, args);
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }
  const claim = (await call(claimFunction, { cost_paise: costPaise })) as Claim | null;
  if (!claim) return { status: "idle" };
  if (!claim.run) return { status: claim.skipped ? "skipped" : "needs_human" };
  const end = (outcome: string, explanation: string) =>
    call("crm_end_whatsapp_followup", { job: claim.job, token: claim.token, outcome, explanation });

  const send = await sendConfigFor(claim.organization);
  if (!send || send.provider !== "gupshup" || send.phone !== claim.phone) {
    // Nothing was sent: release the reservation and leave it for a person.
    await call("crm_finish_whatsapp_reply", { job: claim.outbox, outcome: "rejected", message_id: null, cost_paise: costPaise });
    await end("needs_human", "WhatsApp connection unavailable. Reconnect in Settings.");
    return { status: "needs_human" };
  }
  const result = await sendGupshupTemplate(
    send.token,
    send.app,
    claim.phone,
    claim.recipient,
    claim.template,
    claim.params,
    request,
  );
  await call("crm_finish_whatsapp_reply", {
    job: claim.outbox,
    outcome: result.status,
    message_id: result.messageId,
    cost_paise: costPaise,
  });
  if (result.status === "accepted") await end("sent", "Accepted by Gupshup.");
  else if (result.status === "rejected")
    await end("failed", "Gupshup rejected the template. Check that it is approved and its variables match.");
  else await end("needs_human", "Outcome uncertain. Check WhatsApp before sending again.");
  return { status: result.status };
}
