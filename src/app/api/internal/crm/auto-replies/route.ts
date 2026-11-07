import { workerHealthWindow } from "@/lib/crm/worker-health";
import { supabase } from "@/lib/crm/server";
import { runAutoReplies } from "@/lib/crm/auto-replies-runner";
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
      .eq("id", "replies")
      .maybeSingle(),
    db
      .from("crm_auto_jobs")
      .select("id,organization_id,conversation_id,status,reason,created_at")
      .in("status", ["failed", "needs_human"])
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("crm_usage_events")
      .select("id,organization_id,kind,created_at")
      .eq("status", "reserved")
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
    Date.parse(health.data.last_seen) > Date.now() - workerHealthWindow(process.env) &&
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
  try {
    const results = await runAutoReplies({ maxJobs: 10, deadline: Date.now() + 80_000 });
    return Response.json({ results }, { headers });
  } catch {
    return Response.json(
      {
        error:
          "Worker interrupted. Pending attempts require reconciliation; no automatic resend.",
      },
      { status: 503, headers },
    );
  }
}
