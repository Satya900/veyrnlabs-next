import {
  aiConfig,
  aiCost,
  generateFollowUpDraft,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
} from "./ai-provider.ts";
import { emailConfig, sendFollowUpEmail } from "./email-send.ts";

type RPC = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Claim = {
  id: string;
  token: string;
  knowledge: string;
  lead: { name: string; company: string; service: string; phone: string; email: string; notes: string };
};
type SendJob = { run: boolean; id?: string; recipient?: string; body?: string; subject?: string | null };

export async function processFollowUp(
  env: Record<string, string | undefined>,
  rpc: RPC,
  request: typeof fetch = fetch,
) {
  const ai = aiConfig(env),
    email = emailConfig(env);
  if (env.CRM_FOLLOWUPS_ENABLED !== "true" || !ai || !email)
    return { status: "disabled" };
  async function call(name: string, args: Record<string, unknown>) {
    const result = await rpc(name, args);
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }
  const claim = (await call("crm_claim_followup", {
    maximum_cost: Math.max(1, aiCost(ai, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS)),
  })) as Claim | null;
  if (!claim) return { status: "idle" };
  const end = (outcome: string, explanation: string) =>
    call("crm_end_followup", {
      job: claim.id,
      token: claim.token,
      outcome,
      explanation,
    });

  let draft;
  try {
    draft = await generateFollowUpDraft(ai, claim.knowledge, claim.lead, request);
  } catch {
    await call("crm_finish_followup_draft", {
      job: claim.id,
      token: claim.token,
      sms_answer: "",
      subject_answer: "",
      email_answer: "",
      explanation: "Provider outcome uncertain; reconcile usage before resuming.",
      actual_cost_paise: null,
    });
    await end("failed", "Generation uncertain; manual reconciliation required.");
    return { status: "failed" };
  }
  await call("crm_finish_followup_draft", {
    job: claim.id,
    token: claim.token,
    sms_answer: "",
    subject_answer: draft.emailSubject,
    email_answer: draft.emailBody,
    explanation: draft.reason,
    actual_cost_paise: draft.cost,
  });
  if (draft.needsHuman || !draft.emailBody.trim()) {
    await end("needs_human", draft.reason || "The draft needs a person to review it.");
    return { status: "needs_human" };
  }
  if (!claim.lead.email) {
    await end("skipped", "No email address for this lead.");
    return { status: "skipped" };
  }

  const job = (await call("crm_prepare_followup_send", {
    job: claim.id,
    token: claim.token,
    channel: "email",
    cost_paise: email.cost,
  })) as SendJob;
  if (!job.run || !job.id || !job.recipient || !job.body) {
    await end("skipped", "Email already dispatched or the lead changed since claiming.");
    return { status: "skipped" };
  }
  const result = await sendFollowUpEmail(
    email.key,
    email.from,
    job.recipient,
    job.subject || "Following up",
    job.body,
    request,
  );
  await call("crm_finish_followup_send", {
    send_id: job.id,
    token: claim.token,
    outcome: result.status,
    message_id: result.messageId,
    cost_paise: email.cost,
  });
  const finalOutcome = result.status === "accepted" ? "complete" : "failed";
  await end(
    finalOutcome,
    result.status === "accepted"
      ? "Email accepted by the provider"
      : "Send needs human reconciliation. No automatic retry.",
  );
  return { status: finalOutcome };
}
