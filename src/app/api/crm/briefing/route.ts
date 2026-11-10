import { session, supabase } from "@/lib/crm/server";

const headers = { "Cache-Control": "private, no-store" };
const DAY = 86_400_000;

/**
 * Chat facts for the morning briefing: customers waiting for a reply (their last message is
 * newer than anything sent back, inside WhatsApp's 24-hour reply window), the last chat time
 * per lead, and what the AI did in the last 24 hours. Chats and messages are read through the
 * member's own row-level security; the AI tallies are workspace-wide counts.
 */
export async function GET() {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const since = new Date(Date.now() - DAY).toISOString();
  const recent = new Date(Date.now() - 60 * DAY).toISOString();
  const [chats, inbound, outbound] = await Promise.all([
    auth.db
      .from("crm_whatsapp_conversations")
      .select("id,lead_id,contact_name,sender,last_message_at,ai_disabled")
      .gte("last_message_at", recent)
      .order("last_message_at", { ascending: false })
      .limit(1000),
    auth.db.from("crm_whatsapp_messages").select("conversation_id,sent_at").gte("sent_at", since).limit(2000),
    auth.db
      .from("crm_whatsapp_outbox")
      .select("conversation_id,created_at")
      .in("status", ["accepted", "dispatching", "unknown"])
      .gte("created_at", recent)
      .limit(5000),
  ]);
  if (chats.error || inbound.error || outbound.error)
    return Response.json({ error: "Briefing unavailable." }, { status: 503, headers });

  const latest = (rows: { conversation_id: string; at: string }[]) => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.conversation_id, Math.max(map.get(r.conversation_id) ?? 0, Date.parse(r.at)));
    return map;
  };
  const lastIn = latest(inbound.data.map((m) => ({ conversation_id: m.conversation_id, at: m.sent_at })));
  const lastOut = latest(outbound.data.map((m) => ({ conversation_id: m.conversation_id, at: m.created_at })));

  const lastChat: Record<string, string> = {};
  const waiting = [];
  for (const c of chats.data) {
    const at = Math.max(Date.parse(c.last_message_at), lastOut.get(c.id) ?? 0);
    if (!lastChat[c.lead_id] || Date.parse(lastChat[c.lead_id]) < at) lastChat[c.lead_id] = new Date(at).toISOString();
    const customer = lastIn.get(c.id);
    // Chats with AI off are treated as personal and left out of "waiting for your reply".
    if (customer && customer > (lastOut.get(c.id) ?? 0) && !c.ai_disabled)
      waiting.push({
        conversation_id: c.id,
        lead_id: c.lead_id,
        name: c.contact_name || `+${c.sender}`,
        last_at: new Date(customer).toISOString(),
        window_ends_at: new Date(customer + DAY).toISOString(),
      });
  }
  waiting.sort((a, b) => a.last_at.localeCompare(b.last_at));

  // What the AI did for the workspace in the last 24 hours.
  const db = supabase(undefined, true);
  const [jobs, followups, insights] = await Promise.all([
    db
      .from("crm_auto_jobs")
      .select("conversation_id,status,reason,created_at")
      .eq("organization_id", auth.organizationId)
      .gte("created_at", since)
      .in("status", ["complete", "needs_human"])
      .limit(500),
    db
      .from("crm_whatsapp_followup_jobs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", auth.organizationId)
      .eq("status", "sent")
      .gte("created_at", since),
    db
      .from("crm_lead_insights")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", auth.organizationId)
      .gte("updated_at", since),
  ]);
  const leadOf = new Map(chats.data.map((c) => [c.id, c.lead_id]));
  const handed = (jobs.data ?? [])
    .filter((j) => j.status === "needs_human" && leadOf.has(j.conversation_id))
    .map((j) => ({ lead_id: leadOf.get(j.conversation_id)!, conversation_id: j.conversation_id, at: j.created_at }));
  return Response.json(
    {
      waiting,
      last_chat: lastChat,
      overnight: {
        replies_sent: (jobs.data ?? []).filter((j) => j.status === "complete").length,
        handed_to_you: handed,
        followups_sent: followups.count ?? 0,
        insights_updated: insights.count ?? 0,
      },
    },
    { headers },
  );
}
