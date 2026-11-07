import { after } from "next/server";
import { supabase } from "./server";
import { processAutoReply } from "./auto-worker";
import { tenantSendConfig } from "./whatsapp-tenant";

/**
 * Answers queued automatic WhatsApp replies across every workspace, one at a time, until the
 * queue is empty, `maxJobs` are done or the deadline passes. Called every minute by the cron
 * route and straight after an incoming message by the webhooks, so customers usually get a
 * reply within seconds. Concurrent runs are safe: each job is claimed with a row lock.
 */
export async function runAutoReplies({ maxJobs, deadline }: { maxJobs: number; deadline: number }) {
  const db = supabase(undefined, true);
  const { error } = await db.rpc("crm_worker_maintenance");
  if (error) throw new Error("Worker migration required");
  if (process.env.CRM_AUTO_REPLIES_ENABLED !== "true") return [{ status: "disabled" }];
  const results: { status: string }[] = [];
  try {
    // Leave room for one more AI call and send before the platform's time limit.
    while (results.length < maxJobs && Date.now() < deadline) {
      // Jobs become claimable 6 seconds after the message, so quick bursts get one reply.
      const { data: pending, error: queueError } = await db
        .from("crm_auto_jobs")
        .select("id,organization_id,conversation_id")
        .eq("status", "queued")
        .lte("created_at", new Date(Date.now() - 6000).toISOString())
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (queueError) throw new Error("Queue unavailable");
      if (!pending) break;
      const config = await tenantSendConfig(undefined, pending.organization_id);
      if (!config) {
        await db
          .from("crm_auto_jobs")
          .update({
            status: "needs_human",
            reason: "WhatsApp connection expired or is unavailable. Reconnect in Settings.",
          })
          .eq("id", pending.id)
          .eq("status", "queued");
        await db.from("crm_whatsapp_conversations").update({ ai_paused: true }).eq("id", pending.conversation_id);
        results.push({ status: "needs_human" });
        continue;
      }
      const result = await processAutoReply(
        {
          ...process.env,
          WHATSAPP_ACCESS_TOKEN: config.token,
          WHATSAPP_SEND_ORGANIZATION_ID: config.org,
          WHATSAPP_SEND_PHONE_ID: config.phone,
          WHATSAPP_SEND_WABA_ID: config.waba,
          WHATSAPP_SEND_PROVIDER: config.provider,
          WHATSAPP_SEND_APP: config.app,
        },
        (name, args) => db.rpc(name, args),
      );
      // Another run claimed it first; let that run finish it.
      if (result.status === "idle") break;
      results.push(result);
    }
    await db
      .from("crm_worker_health")
      .update({ last_success: new Date().toISOString(), last_error: null })
      .eq("id", "replies");
    return results;
  } catch (error) {
    await db
      .from("crm_worker_health")
      .update({ last_error: "Processing failed; review pending attempts" })
      .eq("id", "replies");
    throw error;
  }
}

/**
 * For webhooks: after answering the provider, wait out the 6-second burst window and send any
 * automatic reply now instead of at the next cron run. Failures are left for the cron worker,
 * which reports them in worker health.
 */
export function replySoon() {
  if (process.env.CRM_AUTO_REPLIES_ENABLED !== "true") return;
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 7000));
    await runAutoReplies({ maxJobs: 3, deadline: Date.now() + 40_000 }).catch(() => {});
  });
}
