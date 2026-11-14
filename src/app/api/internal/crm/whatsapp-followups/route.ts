import { supabase } from "@/lib/crm/server";
import { workerAuthorized } from "@/lib/crm/worker-auth";
import { workerHealthWindow } from "@/lib/crm/worker-health";
import { processWhatsAppFollowUp } from "@/lib/crm/whatsapp-followup-worker";
import { tenantSendConfig } from "@/lib/crm/whatsapp-tenant";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
const HEALTH = "whatsapp-followups";

export async function GET(request: Request) {
  if (!workerAuthorized(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = supabase(undefined, true);
  const [health, attention] = await Promise.all([
    db.from("crm_worker_health").select("last_seen,last_success,last_error").eq("id", HEALTH).maybeSingle(),
    db
      .from("crm_whatsapp_followup_jobs")
      .select("id,organization_id,lead_id,status,reason,created_at")
      .in("status", ["failed", "needs_human"])
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (health.error || attention.error)
    return Response.json({ error: "Worker schema unavailable." }, { status: 503, headers });
  const healthy =
    health.data &&
    Date.parse(health.data.last_seen) > Date.now() - workerHealthWindow(process.env) &&
    !health.data.last_error;
  return Response.json(
    { healthy: Boolean(healthy), worker: health.data, attention: attention.data },
    { status: healthy ? 200 : 503, headers },
  );
}

export async function POST(request: Request) {
  if (!workerAuthorized(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const cost = Number(process.env.WHATSAPP_REPLY_COST_PAISE);
  if (process.env.WHATSAPP_SEND_ENABLED !== "true" || !Number.isSafeInteger(cost) || cost < 1 || cost > 10000)
    return Response.json({ status: "disabled" }, { headers });
  const db = supabase(undefined, true);
  try {
    const { error } = await db.rpc("crm_whatsapp_followup_maintenance");
    if (error) throw new Error("Worker migration required");
    // A once-a-minute scheduler calls this, so drain a batch per call instead of one job:
    // stop when nothing is due, after 25 sends, or after ~35 seconds (each send can wait 20s; the route allows 60s).
    const started = Date.now();
    const counts: Record<string, number> = {};
    let processed = 0;
    // Welcomes to new leads and visit reminders first (they're time-sensitive), then follow-ups.
    for (const claim of ["crm_claim_lead_welcome", "crm_claim_visit_message", "crm_claim_whatsapp_followup"] as const) {
      while (processed < 25 && Date.now() - started < 35_000) {
        const { status } = await processWhatsAppFollowUp(
          cost,
          (name, args) => db.rpc(name, args),
          (organization) => tenantSendConfig(undefined, organization),
          fetch,
          claim,
        );
        if (status === "idle") break;
        counts[status] = (counts[status] ?? 0) + 1;
        processed++;
      }
    }
    const result = processed ? { status: "processed", ...counts } : { status: "idle" };
    await db
      .from("crm_worker_health")
      .update({ last_success: new Date().toISOString(), last_error: null })
      .eq("id", HEALTH);
    return Response.json(result, { headers });
  } catch {
    await db
      .from("crm_worker_health")
      .update({ last_error: "Processing failed; review pending attempts" })
      .eq("id", HEALTH);
    return Response.json(
      { error: "Worker interrupted. Pending attempts need review; nothing is resent automatically." },
      { status: 503, headers },
    );
  }
}
