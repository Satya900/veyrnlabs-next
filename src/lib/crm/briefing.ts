// The morning briefing: who to call first, who is waiting and who is going quiet. Built only
// from data the CRM already has (scores, follow-ups, chats, activity), so it costs no AI.
import type { Activity, Lead, LeadInsightSummary, Stage } from "./model.ts";

export type Priority = { lead: Lead; points: number; reasons: string[] };

const DAY = 86_400_000;
const CONTACT = new Set(["note", "call", "meeting", "task"]);

/** Leads this person should act on: their own, plus unassigned ones for owners and admins. */
export function myOpenLeads(leads: Lead[], stages: Stage[], userId: string, role: string) {
  const open = new Set(stages.filter((s) => s.kind === "open").map((s) => s.id));
  return leads.filter(
    (l) =>
      open.has(l.stage_id) &&
      !l.client_id &&
      (l.owner_id === userId || (l.owner_id === null && role !== "team")),
  );
}

/** Last real contact with a lead: a logged call, note, meeting or task, or a WhatsApp message. */
export function lastContact(lead: Lead, activities: Activity[], lastChat: Record<string, string>) {
  let latest = Date.parse(lead.created_at);
  for (const a of activities)
    if (a.lead_id === lead.id && CONTACT.has(a.kind)) latest = Math.max(latest, Date.parse(a.created_at));
  if (lastChat[lead.id]) latest = Math.max(latest, Date.parse(lastChat[lead.id]));
  return latest;
}

/**
 * Ranks leads for "call these first". Points: a customer waiting for a reply 40, Hot 50 /
 * Warm 25 / not scored yet 10, follow-up due or overdue 30 (+2 per overdue day, up to +20),
 * a new lead nobody has contacted 20, and up to 10 for deal size. Cold leads with nothing
 * else going on don't make the list.
 */
export function rankLeads(
  leads: Lead[],
  insights: LeadInsightSummary[],
  activities: Activity[],
  waiting: Set<string>,
  lastChat: Record<string, string>,
  now: number,
  limit = 3,
): Priority[] {
  const score = new Map(insights.map((i) => [i.lead_id, i.score]));
  const ranked: Priority[] = [];
  for (const lead of leads) {
    let points = 0;
    const reasons: string[] = [];
    if (waiting.has(lead.id)) {
      points += 40;
      reasons.push("waiting for your reply on WhatsApp");
    }
    const s = score.get(lead.id);
    if (s === "hot") {
      points += 50;
      reasons.push("Hot lead");
    } else if (s === "warm") {
      points += 25;
      reasons.push("Warm lead");
    } else if (!s) points += 10;
    if (lead.follow_up && Date.parse(lead.follow_up) <= now + DAY / 2) {
      const late = Math.floor((now - Date.parse(lead.follow_up)) / DAY);
      points += 30 + Math.min(Math.max(late, 0) * 2, 20);
      reasons.push(late >= 1 ? `follow-up ${late} day${late === 1 ? "" : "s"} overdue` : "follow-up due today");
    }
    if (now - Date.parse(lead.created_at) < 2 * DAY && lastContact(lead, activities, lastChat) === Date.parse(lead.created_at)) {
      points += 20;
      reasons.push("new lead, not contacted yet");
    }
    points += Math.min(10, Math.floor((lead.value || 0) / 1_000_000));
    if (s === "cold" && reasons.length === 0) continue;
    if (points > 10) ranked.push({ lead, points, reasons });
  }
  return ranked.sort((a, b) => b.points - a.points || Date.parse(a.lead.created_at) - Date.parse(b.lead.created_at)).slice(0, limit);
}

/** Open leads with no real contact for 7+ days (and older than a week), quietest first. */
export function goingCold(
  leads: Lead[],
  activities: Activity[],
  lastChat: Record<string, string>,
  now: number,
  limit = 5,
) {
  return leads
    .map((lead) => ({ lead, last: lastContact(lead, activities, lastChat) }))
    .filter(({ lead, last }) => now - last >= 7 * DAY && now - Date.parse(lead.created_at) >= 7 * DAY)
    .sort((a, b) => a.last - b.last)
    .slice(0, limit)
    .map(({ lead, last }) => ({ lead, days: Math.floor((now - last) / DAY) }));
}
