import { supabase } from "@/lib/crm/server";
import { processFollowUp } from "@/lib/crm/followup-worker";
import { workerAuthorized } from "@/lib/crm/worker-auth";
export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  if (!workerAuthorized(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = supabase(undefined, true);
  const [health, failed, pending] = await Promise.all([
    db
      .from("crm_worker_health")
      .select("last_seen,last_success,last_error")
      .eq("id", "followups")
      .maybeSingle(),
    db
      .from("crm_followup_jobs")
      .select("id,organization_id,lead_id,status,reason,created_at")
      .in("status", ["failed", "needs_human"])
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("crm_usage_events")
      .select("id,organization_id,kind,created_at")
      .eq("status", "reserved")
      .in("kind", ["sms", "email"])
      .lt("created_at", new Date(Date.now() - 300000).toISOString())
      .limit(50),
  ]);
  if (health.error || failed.error || pending.error)
    return Response.json(
      { error: "Worker schema unavailable." },
      { status: 503, headers },
    );
  const healthy =
    health.data &&
    Date.parse(health.data.last_seen) > Date.now() - 120000 &&
    !health.data.last_error;
  return Response.json(
    {
      healthy: Boolean(healthy),
      worker: health.data,
      attention: failed.data,
      reservations: pending.data,
    },
    { status: healthy ? 200 : 503, headers },
  );
}
export async function POST(request: Request) {
  if (!workerAuthorized(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = supabase(undefined, true);
  try {
    const { error } = await db.rpc("crm_followup_maintenance");
    if (error) throw new Error("Worker migration required");
    const result = await processFollowUp(process.env, (name, args) =>
      db.rpc(name, args),
    );
    await db
      .from("crm_worker_health")
      .update({ last_success: new Date().toISOString(), last_error: null })
      .eq("id", "followups");
    return Response.json(result, { headers });
  } catch {
    await db
      .from("crm_worker_health")
      .update({ last_error: "Processing failed; review pending attempts" })
      .eq("id", "followups");
    return Response.json(
      {
        error:
          "Worker interrupted. Pending attempts require reconciliation; no automatic resend.",
      },
      { status: 503, headers },
    );
  }
}
