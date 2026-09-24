import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";
import { tenantSendConfig } from "@/lib/crm/whatsapp-tenant";
import {
  aiConfig,
  aiCost,
  generateAIDraft,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
} from "@/lib/crm/ai-provider";

export const runtime = "nodejs";
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns =
  "id,source_message_id,status,reply,reason,created_at,proposed_visit_at,booking_status";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const conversation = new URL(request.url).searchParams.get("conversation");
  if (conversation) {
    if (!uuid.test(conversation))
      return Response.json({ error: "Invalid conversation." }, { status: 400 });
    const [chat, draft, latest] = await Promise.all([
      auth.db
        .from("crm_whatsapp_conversations")
        .select("id,ai_paused")
        .eq("id", conversation)
        .maybeSingle(),
      auth.db
        .from("crm_ai_drafts")
        .select(columns)
        .eq("conversation_id", conversation)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      auth.db
        .from("crm_whatsapp_messages")
        .select("id")
        .eq("conversation_id", conversation)
        .order("sent_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (chat.error || draft.error || latest.error)
      return Response.json(
        {
          error:
            "AI setup is unavailable. Check that its migration has been applied.",
        },
        { status: 503 },
      );
    if (!chat.data)
      return Response.json(
        { error: "Conversation unavailable." },
        { status: 404 },
      );
    return Response.json(
      {
        paused: chat.data.ai_paused,
        draft:
          draft.data &&
          (chat.data.ai_paused ||
            latest.data?.id !== draft.data.source_message_id)
            ? {
                ...draft.data,
                status: "superseded",
                reply: "",
                reason: "The conversation changed or human handover is active.",
              }
            : draft.data,
        provider_ready: Boolean(aiConfig(process.env)),
      },
      { headers },
    );
  }
  if (auth.member.role === "team")
    return Response.json({ error: "Admin access required." }, { status: 403 });
  const { data, error } = await auth.db
    .from("crm_ai_settings")
    .select("organization_id,knowledge,drafts_enabled,auto_enabled")
    .maybeSingle();
  if (error)
    return Response.json(
      { error: "AI settings unavailable. Check the migration." },
      { status: 503 },
    );
  const jobs = await auth.db
    .from("crm_auto_jobs")
    .select("id,status,reason,created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  if (jobs.error)
    return Response.json(
      { error: "Automatic reply setup requires its migration." },
      { status: 503, headers },
    );
  return Response.json(
    {
      jobs: jobs.data,
      worker_healthy: await workerHealthy(),
      settings: data ?? { knowledge: "", drafts_enabled: false },
      provider_ready: Boolean(aiConfig(process.env)),
      automation_ready:
        process.env.CRM_AUTO_REPLIES_ENABLED === "true" &&
        Boolean(aiConfig(process.env)) &&
        (process.env.CRM_WORKER_SECRET?.length ?? 0) >= 32 &&
        Boolean(
          data?.organization_id &&
          (await tenantSendConfig(auth.member.id))?.org === data.organization_id,
        ),
    },
    { headers },
  );
}

async function workerHealthy() {
  const { data } = await supabase(undefined, true).from("crm_worker_health").select("last_seen,last_error").eq("id", "replies").maybeSingle();
  return Boolean(data && !data.last_error && Date.parse(data.last_seen) > Date.now() - 120000);
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    const body = await jsonBody(request, 60000);
    if (body.action === "automation") {
      if (auth.member.role === "team" || typeof body.enabled !== "boolean")
        throw new Error("Admin access and a valid setting are required.");
      if (body.enabled && process.env.CRM_AUTO_REPLIES_ENABLED !== "true")
        throw new Error("Automatic reply worker has not been enabled yet.");
      if (body.enabled) {
        const { data: settings } = await auth.db
          .from("crm_ai_settings")
          .select("organization_id")
          .maybeSingle();
        if (
          !settings ||
          (await tenantSendConfig(auth.member.id))?.org !== settings.organization_id ||
          !aiConfig(process.env) ||
          (process.env.CRM_WORKER_SECRET?.length ?? 0) < 32
        )
          throw new Error(
            "Automatic replies are not configured for this workspace.",
          );
      }
      const { error } = await auth.db.rpc("crm_set_auto_replies", {
        enabled: body.enabled,
      });
      if (error)
        throw new Error(
          error.code === "P0001"
            ? error.message
            : "Unable to update automatic replies.",
        );
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "settings") {
      if (auth.member.role === "team")
        return Response.json(
          { error: "Admin access required." },
          { status: 403 },
        );
      if (
        typeof body.knowledge !== "string" ||
        body.knowledge.length > 12000 ||
        typeof body.enabled !== "boolean" ||
        (body.enabled && body.knowledge.trim().length < 20)
      )
        throw new Error(
          "Add company and property details before enabling drafts (20–12,000 characters).",
        );
      const { error } = await auth.db.rpc("crm_save_ai_settings", {
        company_knowledge: body.knowledge.trim(),
        enabled: body.enabled,
      });
      if (error) throw new Error("Unable to save AI settings.");
      return Response.json({ ok: true }, { headers });
    }
    if (typeof body.conversation !== "string" || !uuid.test(body.conversation))
      throw new Error("Invalid conversation.");
    if (body.action === "handover") {
      if (typeof body.paused !== "boolean")
        throw new Error("Invalid handover.");
      const { error } = await auth.db.rpc("crm_set_ai_handover", {
        conversation: body.conversation,
        paused: body.paused,
      });
      if (error)
        throw new Error("Unable to change handover for this conversation.");
      return Response.json({ ok: true }, { headers });
    }
    if (body.action !== "generate") throw new Error("Unknown action.");
    const config = aiConfig(process.env);
    if (!config)
      return Response.json(
        {
          error:
            "AI provider and cost rates are not configured yet. Your admin can still save company knowledge.",
        },
        { status: 503 },
      );
    const service = supabase(undefined, true);
    const { data: job, error } = await service.rpc("crm_start_ai_draft", {
      actor: auth.member.id,
      conversation: body.conversation,
      selected_model: config.model,
      // The ledger requires a positive reservation; free calls release this paise on completion.
      maximum_cost: Math.max(
        1,
        aiCost(config, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS),
      ),
    });
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "Unable to start this draft. Check plan allowances and AI setup.",
      );
    if (job.run) {
      let result;
      try {
        result = await generateAIDraft(config, job.knowledge, job.history);
      } catch {
        // Unknown provider outcomes retain the reservation and cannot silently trigger another paid call.
        await service.rpc("crm_finish_ai_draft", {
          job: job.id,
          answer: "",
          human_required: true,
          explanation:
            "Generation could not be confirmed. Ask support to reconcile this attempt before retrying.",
          actual_cost: null,
        });
        throw new Error(
          "Generation could not be confirmed. The attempt is saved for review; no message was sent.",
        );
      }
      const finished = await service.rpc("crm_finish_ai_draft", {
        job: job.id,
        answer: result.reply,
        human_required: result.needs_human,
        explanation: result.reason,
        actual_cost: result.cost,
      });
      if (finished.error)
        throw new Error(
          "The draft could not be saved. The attempt is retained for reconciliation; no message was sent.",
        );
    }
    const { data: draft, error: readError } = await auth.db
      .from("crm_ai_drafts")
      .select(columns)
      .eq("id", job.id)
      .maybeSingle();
    if (readError || !draft)
      throw new Error("Draft unavailable. Refresh the conversation.");
    return Response.json({ draft }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "AI action failed." },
      { status: 400, headers },
    );
  }
}
