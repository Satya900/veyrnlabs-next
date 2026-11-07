import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";
import { aiConfig, aiCost, generateLeadInsight, MAX_OUTPUT_TOKENS } from "@/lib/crm/ai-provider";
import { finishUsage } from "@/lib/crm/usage";

export const runtime = "nodejs";
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };
const columns = "lead_id,score,score_reason,summary,details,suggestions,based_on,updated_at";

/** Reads go through the member's own row-level security, so they only see leads they may see. */
async function visible(auth: NonNullable<Awaited<ReturnType<typeof session>>>, conversation: string) {
  const { data: chat } = await auth.db
    .from("crm_whatsapp_conversations")
    .select("id,lead_id,last_message_at,ai_disabled")
    .eq("id", conversation)
    .maybeSingle();
  if (!chat) return null;
  const { data: insight } = await auth.db
    .from("crm_lead_insights")
    .select(columns)
    .eq("lead_id", chat.lead_id)
    .maybeSingle();
  return {
    chat,
    insight,
    stale: !insight || !insight.based_on || Date.parse(chat.last_message_at) > Date.parse(insight.based_on),
  };
}

export async function GET(request: Request) {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const conversation = new URL(request.url).searchParams.get("conversation") ?? "";
  if (!uuid.test(conversation))
    return Response.json({ error: "Invalid conversation." }, { status: 400 });
  const found = await visible(auth, conversation);
  if (!found) return Response.json({ error: "Conversation unavailable." }, { status: 404 });
  return Response.json(
    {
      insight: found.chat.ai_disabled ? null : found.insight,
      stale: found.stale,
      disabled: Boolean(found.chat.ai_disabled),
      available: Boolean(aiConfig(process.env)) && !found.chat.ai_disabled,
    },
    { headers },
  );
}

// Maps the usage ledger's refusals to something an agent can act on.
function refusal(message: string) {
  if (/allowance reached/.test(message)) return "You've used this month's AI allowance.";
  if (/budget reached/.test(message)) return "This month's AI budget is used up.";
  if (/No active usage period|Subscription inactive/.test(message)) return "AI insights need an active plan.";
  return "AI insights are unavailable right now.";
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    const body = await jsonBody(request, 2000);
    const conversation = typeof body.conversation === "string" ? body.conversation : "";
    if (!uuid.test(conversation)) throw new Error("Invalid conversation.");
    const found = await visible(auth, conversation);
    if (!found) throw new Error("Conversation unavailable.");
    if (found.chat.ai_disabled) throw new Error("AI is off for this contact.");
    // Nothing new since the last analysis: return it without spending an AI action.
    if (!found.stale && body.force !== true)
      return Response.json({ insight: found.insight, stale: false }, { headers });
    const config = aiConfig(process.env);
    if (!config) throw new Error("AI isn't switched on for this workspace yet.");

    const service = supabase(undefined, true);
    const { data: context, error: contextError } = await service.rpc("crm_lead_insight_context", {
      actor: auth.member.id,
      conversation,
    });
    if (contextError || !context)
      throw new Error(
        /Seat inactive/.test(contextError?.message ?? "")
          ? "Your seat isn't active. Ask the workspace owner."
          : "Conversation unavailable.",
      );
    if (!context.messages.some((m: { from: string }) => m.from === "customer"))
      throw new Error("Nothing to analyse yet. Insights appear once the customer has written.");

    // Reserve an upper bound first: input tokens never exceed the request's UTF-8 bytes,
    // plus room for the instructions and schema.
    const maxCost = Math.max(
      1,
      aiCost(config, Buffer.byteLength(JSON.stringify(context)) + 3000, MAX_OUTPUT_TOKENS),
    );
    const { data: event, error: reserveError } = await service.rpc("crm_reserve_usage", {
      org: context.organization_id,
      request_key: `insight:${context.lead_id}:${crypto.randomUUID()}`,
      usage_kind: "ai",
      quantity: 1,
      max_cost_paise: maxCost,
    });
    if (reserveError || typeof event !== "string") throw new Error(refusal(reserveError?.message ?? ""));

    let result;
    try {
      result = await generateLeadInsight(config, context);
    } catch {
      // The provider may have billed us; keep the reservation for reconciliation.
      throw new Error("The AI didn't respond. Try again in a minute.");
    }
    await finishUsage(context.organization_id, event, result.cost);
    if (!result.insight) throw new Error("The AI couldn't read this chat. Try again.");
    const { insight } = result;
    const { error: saveError } = await service.rpc("crm_save_lead_insight", {
      org: context.organization_id,
      lead: context.lead_id,
      conversation,
      generated_from: context.based_on,
      new_score: insight.score,
      new_reason: insight.score_reason,
      new_summary: insight.summary,
      new_details: insight.details,
      new_suggestions: insight.suggestions,
      looking_for: insight.details.looking_for,
      budget_inr: insight.details.budget_inr,
    });
    if (saveError) throw new Error("The insight couldn't be saved. Try again.");
    const { data: saved } = await auth.db
      .from("crm_lead_insights")
      .select(columns)
      .eq("lead_id", context.lead_id)
      .maybeSingle();
    return Response.json({ insight: saved, stale: false }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "AI insights failed." },
      { status: 400, headers },
    );
  }
}
