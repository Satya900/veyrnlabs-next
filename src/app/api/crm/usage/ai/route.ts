import { session, supabase } from "@/lib/crm/server";

const headers = { "Cache-Control": "private, no-store" };

/**
 * This month's AI and WhatsApp usage for the sidebar meter and Settings, for every member:
 * allowances are shared by the whole workspace. Counts mirror the usage ledger's own rule
 * (every reservation that wasn't cancelled counts against the allowance).
 */
export async function GET() {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const db = supabase(undefined, true);
  const now = new Date().toISOString();
  const { data: period, error } = await db
    .from("crm_usage_periods")
    .select("id,starts_at,ends_at,ai_limit,whatsapp_limit,trial_budget_paise")
    .eq("organization_id", auth.organizationId)
    .lte("starts_at", now)
    .gt("ends_at", now)
    .maybeSingle();
  if (error) return Response.json({ error: "Usage is unavailable." }, { status: 503, headers });
  if (!period) return Response.json({ period: null }, { headers });

  const [events, automatic, topups] = await Promise.all([
    db
      .from("crm_usage_events")
      .select("event_key,kind,units")
      .eq("period_id", period.id)
      .in("kind", ["ai", "whatsapp"])
      .neq("status", "cancelled")
      .limit(20000),
    // Automatic replies are AI drafts started by the reply worker in this period.
    db
      .from("crm_auto_jobs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", auth.organizationId)
      .not("draft_id", "is", null)
      .gte("created_at", period.starts_at)
      .lt("created_at", period.ends_at),
    // Paid top-ups already raised ai_limit; reported so the extra is visible.
    db.from("crm_ai_topups").select("actions").eq("period_id", period.id).eq("status", "paid"),
  ]);
  if (events.error) return Response.json({ error: "Usage is unavailable." }, { status: 503, headers });

  let aiUsed = 0,
    whatsappUsed = 0,
    insights = 0,
    drafts = 0,
    emails = 0;
  for (const e of events.data) {
    if (e.kind === "whatsapp") {
      whatsappUsed += e.units;
      continue;
    }
    aiUsed += e.units;
    if (e.event_key.startsWith("insight:")) insights += e.units;
    else if (e.event_key.startsWith("ai-draft:")) drafts += e.units;
    else emails += e.units;
  }
  const autoReplies = Math.min(drafts, automatic.count ?? 0);
  return Response.json(
    {
      period: { starts_at: period.starts_at, ends_at: period.ends_at, trial: period.trial_budget_paise !== null },
      ai: {
        used: aiUsed,
        limit: period.ai_limit,
        // Before the top-ups migration this query errors; report none.
        topup: topups.error ? 0 : topups.data.reduce((sum, t) => sum + t.actions, 0),
      },
      whatsapp: { used: whatsappUsed, limit: period.whatsapp_limit },
      breakdown: {
        insights,
        auto_replies: autoReplies,
        drafts: drafts - autoReplies,
        emails,
      },
    },
    { headers },
  );
}
