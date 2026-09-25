import { workerHealthWindow } from "@/lib/crm/worker-health";
import { supabase } from "@/lib/crm/server";
import { processAutoReply } from "@/lib/crm/auto-worker";
import { tenantSendConfig } from "@/lib/crm/whatsapp-tenant";
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
  const db = supabase(undefined, true);
  try {
    const { error } = await db.rpc("crm_worker_maintenance");
    if (error) throw new Error("Worker migration required");
    if (process.env.CRM_AUTO_REPLIES_ENABLED !== "true")
      return Response.json({ status: "disabled" }, { headers });
    const { data: pending, error: queueError } = await db
      .from("crm_auto_jobs")
      .select("id,organization_id,conversation_id")
      .eq("status", "queued")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (queueError) throw new Error("Queue unavailable");
    let result: { status: string } = { status: "idle" };
    if (pending) {
      const config = await tenantSendConfig(undefined, pending.organization_id);
      if (!config) {
        await db
          .from("crm_auto_jobs")
          .update({
            status: "needs_human",
            reason:
              "WhatsApp connection expired or is unavailable. Reconnect in Settings.",
          })
          .eq("id", pending.id)
          .eq("status", "queued");
        await db
          .from("crm_whatsapp_conversations")
          .update({ ai_paused: true })
          .eq("id", pending.conversation_id);
        result = { status: "needs_human" };
      } else {
        result = await processAutoReply(
          {
            ...process.env,
            WHATSAPP_ACCESS_TOKEN: config.token,
            WHATSAPP_SEND_ORGANIZATION_ID: config.org,
            WHATSAPP_SEND_PHONE_ID: config.phone,
            WHATSAPP_SEND_WABA_ID: config.waba,
          },
          (name, args) => db.rpc(name, args),
        );
      }
    }
    await db
      .from("crm_worker_health")
      .update({ last_success: new Date().toISOString(), last_error: null })
      .eq("id", "replies");
    return Response.json(result, { headers });
  } catch {
    await db
      .from("crm_worker_health")
      .update({ last_error: "Processing failed; review pending attempts" })
      .eq("id", "replies");
    return Response.json(
      {
        error:
          "Worker interrupted. Pending attempts require reconciliation; no automatic resend.",
      },
      { status: 503, headers },
    );
  }
}
