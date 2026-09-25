import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";
import { aiConfig } from "@/lib/crm/ai-provider";
import { emailConfig } from "@/lib/crm/email-send";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };

async function workerHealthy() {
  const { data } = await supabase(undefined, true)
    .from("crm_worker_health")
    .select("last_seen,last_error")
    .eq("id", "followups")
    .maybeSingle();
  return Boolean(
    data && !data.last_error && Date.parse(data.last_seen) > Date.now() - 120000,
  );
}

export async function GET() {
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (auth.member.role === "team")
    return Response.json({ error: "Admin access required." }, { status: 403 });
  const { data, error } = await auth.db
    .from("crm_ai_settings")
    .select("followup_enabled")
    .maybeSingle();
  if (error)
    return Response.json(
      { error: "Follow-up settings unavailable. Check the migration." },
      { status: 503 },
    );
  const jobs = await auth.db
    .from("crm_followup_jobs")
    .select("id,lead_id,status,reason,created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  if (jobs.error)
    return Response.json(
      { error: "Automatic follow-up setup requires its migration." },
      { status: 503, headers },
    );
  return Response.json(
    {
      jobs: jobs.data,
      worker_healthy: await workerHealthy(),
      enabled: Boolean(data?.followup_enabled),
      automation_ready:
        process.env.CRM_FOLLOWUPS_ENABLED === "true" &&
        Boolean(aiConfig(process.env)) &&
        Boolean(emailConfig(process.env)) &&
        (process.env.CRM_WORKER_SECRET?.length ?? 0) >= 32,
    },
    { headers },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (auth.member.role === "team")
    return Response.json({ error: "Admin access required." }, { status: 403 });
  try {
    const body = await jsonBody(request, 1000);
    if (typeof body.enabled !== "boolean") throw new Error("Invalid setting.");
    if (body.enabled && process.env.CRM_FOLLOWUPS_ENABLED !== "true")
      throw new Error("The follow-up worker has not been enabled yet.");
    const { error } = await auth.db.rpc("crm_set_followups", {
      enabled: body.enabled,
    });
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "Unable to update automatic follow-ups.",
      );
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Follow-up action failed.",
      },
      { status: 400, headers },
    );
  }
}
