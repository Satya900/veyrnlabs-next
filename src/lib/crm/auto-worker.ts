import {
  aiConfig,
  aiCost,
  generateAIDraft,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
} from "./ai-provider.ts";
import { sendConfig, sendWhatsAppReply } from "./whatsapp-send.ts";
import { overlaps, resolveIstSlot } from "./calendar-slots.ts";
import { decryptCalendarToken } from "./calendar-crypto.ts";
import {
  createCalendarEvent,
  getFreeBusy,
  googleCalendarConfigured,
  refreshAccessToken,
} from "./google-calendar.ts";
type RPC = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Claim = { id: string; token: string };
type DraftJob = {
  id: string;
  run: boolean;
  knowledge: string;
  history: { text: string }[];
};
type SendJob = {
  id: string;
  run: boolean;
  status: string;
  phone: string;
  recipient: string;
  body: string;
};
type BookingPrep = {
  run: boolean;
  event_id?: string;
  calendar_id?: string;
  refresh_token_encrypted?: string;
  lead_name?: string;
  lead_company?: string;
  lead_email?: string;
};

function confirmationMessage(start: Date) {
  const when = start.toLocaleString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  return `You're all set, your site visit is booked for ${when} (IST). Looking forward to seeing you then!`;
}

export async function processAutoReply(
  env: Record<string, string | undefined>,
  rpc: RPC,
  request: typeof fetch = fetch,
) {
  const ai = aiConfig(env),
    send = sendConfig(env);
  if (env.CRM_AUTO_REPLIES_ENABLED !== "true" || !ai || !send)
    return { status: "disabled" };
  async function call(name: string, args: Record<string, unknown>) {
    const result = await rpc(name, args);
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }
  const claim = (await call("crm_claim_auto_reply", {
    org: send.org,
  })) as Claim | null;
  if (!claim) return { status: "idle" };
  const end = (outcome: string, explanation: string) =>
    call("crm_end_auto_reply", {
      job: claim.id,
      token: claim.token,
      outcome,
      explanation,
    });
  let started: DraftJob | null = null;
  try {
    started = (await call("crm_start_auto_reply", {
      job: claim.id,
      token: claim.token,
      model: ai.model,
      maximum_cost: Math.max(
        1,
        aiCost(ai, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS),
      ),
    })) as DraftJob;
  } catch {
    await end(
      "needs_human",
      "Automatic reply could not start. Review settings, allowance and the conversation.",
    );
    return { status: "needs_human" };
  }
  let answer;
  try {
    answer = await generateAIDraft(
      ai,
      started.knowledge,
      started.history,
      request,
    );
  } catch {
    await call("crm_finish_ai_draft", {
      job: started.id,
      answer: "",
      human_required: true,
      explanation:
        "Provider outcome uncertain; reconcile usage before resuming.",
      actual_cost: null,
    });
    await end(
      "failed",
      "Generation uncertain; manual reconciliation required.",
    );
    return { status: "failed" };
  }
  // Keep automated text short; ambiguous or overlong responses go to a person, never silently trimmed.
  let needsHuman =
    answer.needs_human ||
    !answer.reply.trim() ||
    answer.reply.split(/\s+/).length > 150 ||
    (answer.reply.match(/[?？]/g)?.length ?? 0) > 2;

  // A booking request with an unresolved (ambiguous, out of business hours, off the
  // 30-minute grid, or already-past) date/time always hands off to a human rather than
  // guessing; only a clean, on-grid future slot is ever attempted automatically below.
  let proposedVisitAt: Date | null = null;
  if (answer.booking_request.requested) {
    proposedVisitAt = resolveIstSlot(
      answer.booking_request.date,
      answer.booking_request.time,
    );
    if (!proposedVisitAt) needsHuman = true;
  }

  let finalReply = answer.reply;
  let finalReason = answer.reason;
  if (!needsHuman && proposedVisitAt) {
    if (!googleCalendarConfigured(env)) {
      needsHuman = true;
    } else {
      const startIso = proposedVisitAt.toISOString();
      const endIso = new Date(
        proposedVisitAt.getTime() + 30 * 60_000,
      ).toISOString();
      try {
        const prep = (await call("crm_prepare_auto_booking", {
          job: claim.id,
          token: claim.token,
          start_iso: startIso,
          end_iso: endIso,
        })) as BookingPrep;
        if (!prep.run) {
          needsHuman = true;
        } else {
          const refreshToken = decryptCalendarToken(
            env,
            prep.refresh_token_encrypted!,
          );
          const { access_token } = await refreshAccessToken(
            env,
            refreshToken,
            request,
          );
          const busy = await getFreeBusy(
            access_token,
            prep.calendar_id!,
            startIso,
            endIso,
            request,
          );
          if (overlaps(proposedVisitAt, new Date(endIso), busy)) {
            await call("crm_finish_auto_booking", {
              job: claim.id,
              token: claim.token,
              outcome: "unavailable",
              start_iso: startIso,
            });
            needsHuman = true;
          } else {
            const attendeeEmail =
              typeof prep.lead_email === "string" &&
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prep.lead_email)
                ? prep.lead_email
                : undefined;
            await createCalendarEvent(
              access_token,
              prep.calendar_id!,
              {
                summary: `Site visit: ${prep.lead_name}${prep.lead_company ? ` (${prep.lead_company})` : ""}`,
                eventId: prep.event_id,
                description: "Booked automatically from WhatsApp via Veyrn CRM.",
                startIso,
                endIso,
                attendeeEmail,
              },
              request,
            );
            await call("crm_finish_auto_booking", {
              job: claim.id,
              token: claim.token,
              outcome: "booked",
              start_iso: startIso,
            });
            finalReply = confirmationMessage(proposedVisitAt);
            finalReason = "Booked automatically from the customer's request.";
          }
        }
      } catch {
        try {
          await call("crm_finish_auto_booking", {
            job: claim.id,
            token: claim.token,
            outcome: "failed",
            start_iso: startIso,
          });
        } catch {
          // Best-effort: the draft's booking_status may stay 'attempted'; the abandoned-job
          // cleanup in crm_claim_auto_reply pauses the conversation for a human either way.
        }
        needsHuman = true;
      }
    }
  }

  await call("crm_finish_ai_draft", {
    job: started.id,
    answer: finalReply,
    human_required: needsHuman,
    explanation: finalReason,
    actual_cost: answer.cost,
    proposed_at: proposedVisitAt ? proposedVisitAt.toISOString() : null,
  });
  if (needsHuman) {
    await end("needs_human", "The response needs a person to review it.");
    return { status: "needs_human" };
  }
  let job: SendJob;
  try {
    job = (await call("crm_prepare_auto_reply", {
      job: claim.id,
      token: claim.token,
      scoped_org: send.org,
      scoped_phone: send.phone,
      scoped_waba: send.waba,
      cost_paise: send.cost,
    })) as SendJob;
  } catch {
    await end(
      "needs_human",
      "Reply withheld: conversation, settings or allowance changed. Review before resuming.",
    );
    return { status: "needs_human" };
  }
  if (!job.run) {
    await end("skipped", "Reply already has a send attempt; no resend.");
    return { status: "skipped" };
  }
  const result = await sendWhatsAppReply(
    send.token,
    job.phone,
    job.recipient,
    job.body,
    request,
  );
  await call("crm_finish_whatsapp_reply", {
    job: job.id,
    outcome: result.status,
    message_id: result.messageId,
    cost_paise: send.cost,
  });
  await end(
    result.status === "accepted" ? "complete" : "failed",
    result.status === "accepted"
      ? "Reply accepted by WhatsApp"
      : "Send needs human reconciliation. No automatic retry.",
  );
  return { status: result.status };
}
