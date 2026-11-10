"use client";
import { useEffect, useState } from "react";
import { crmFetch } from "./activity";
import { useWorkspaceContext } from "./context";
import { ScoreBadge } from "./ScoreBadge";
import { goingCold, myOpenLeads, rankLeads } from "@/lib/crm/briefing";
import { money } from "@/lib/crm/model";

type BriefingData = {
  waiting: { conversation_id: string; lead_id: string; name: string; last_at: string; window_ends_at: string }[];
  last_chat: Record<string, string>;
  overnight: {
    replies_sent: number;
    handed_to_you: { lead_id: string; conversation_id: string; at: string }[];
    followups_sent: number;
    insights_updated: number;
  };
};

const HOUR = 3_600_000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
function ago(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** The top of Overview: who to call first, who is waiting, who is going quiet, and what the AI did. */
export function Briefing() {
  const { data, stages, now, demo, setSelected, changeView } = useWorkspaceContext();
  const [facts, setFacts] = useState<BriefingData | null>(null);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    crmFetch("/api/crm/briefing", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => (res.ok ? setFacts(await res.json()) : null))
      .catch(() => {
        /* The briefing still works from lead data alone. */
      });
    return () => controller.abort();
  }, [demo]);

  const mine = myOpenLeads(data.leads, stages, data.user.id, data.user.role);
  const mineIds = new Set(mine.map((l) => l.id));
  const lastChat = facts?.last_chat ?? {};
  const waiting = (facts?.waiting ?? []).filter((w) => mineIds.has(w.lead_id));
  const priorities = rankLeads(mine, data.insights ?? [], data.activities, new Set(waiting.map((w) => w.lead_id)), lastChat, now);
  const overdue = mine
    .filter((l) => l.follow_up && Date.parse(l.follow_up) < now - HOUR)
    .sort((a, b) => a.follow_up!.localeCompare(b.follow_up!));
  const cold = goingCold(mine, data.activities, lastChat, now);
  const overnight = facts?.overnight;
  const handed = (overnight?.handed_to_you ?? []).filter((h) => data.leads.some((l) => l.id === h.lead_id));
  const summary = data.insights?.length ? new Map(data.insights.map((i) => [i.lead_id, i])) : new Map();
  const leadName = (id: string) => data.leads.find((l) => l.id === id)?.name ?? "A lead";

  const hour = Number(new Date(now).toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const headline = [
    waiting.length && plural(waiting.length, "customer") + " waiting for a reply",
    overdue.length && plural(overdue.length, "follow-up") + " overdue",
    overnight?.replies_sent && `AI replied to ${plural(overnight.replies_sent, "chat")} in the last 24 h`,
  ].filter(Boolean);

  return (
    <section className="crm-panel crm-briefing" aria-label="Today's briefing">
      <div className="crm-briefing-head">
        <div>
          <h2>
            {greeting}
            {data.user.name ? `, ${data.user.name.split(" ")[0]}` : ""}
          </h2>
          <p>{headline.length ? headline.join(" · ") : "Nothing urgent. A good day to reach out to new leads."}</p>
        </div>
        <span className="crm-briefing-note">Built from your leads and chats · uses no AI actions</span>
      </div>

      <div className="crm-briefing-section">
        <h3>Call these first</h3>
        {priorities.length ? (
          <ol className="crm-briefing-priorities">
            {priorities.map(({ lead, reasons }, i) => (
              <li key={lead.id}>
                <button type="button" onClick={() => setSelected(lead.id)}>
                  <span className="crm-briefing-rank">{i + 1}</span>
                  <span className="crm-briefing-lead">
                    <strong>
                      {lead.name} <ScoreBadge insight={summary.get(lead.id)} />
                    </strong>
                    <small>{reasons.length ? reasons.join(" · ") : "Open lead"}</small>
                    {summary.get(lead.id)?.summary && <em>{summary.get(lead.id)!.summary}</em>}
                  </span>
                  <span className="crm-briefing-side">
                    {lead.value > 0 && <b>{money(lead.value)}</b>}
                    {lead.phone && <small>{lead.phone}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="crm-muted">No open leads need you right now.</p>
        )}
      </div>

      <div className="crm-briefing-columns">
        <div className="crm-briefing-section">
          <h3>
            Waiting for your reply <span className="crm-count">{waiting.length}</span>
          </h3>
          {waiting.length ? (
            <ul>
              {waiting.slice(0, 5).map((w) => {
                const left = Math.max(0, Math.round((Date.parse(w.window_ends_at) - now) / HOUR));
                return (
                  <li key={w.conversation_id}>
                    <button type="button" onClick={() => changeView("WhatsApp")}>
                      <strong>{w.name}</strong>
                      <small>
                        wrote {ago(w.last_at, now)} · {left > 0 ? `free reply for ${left} more h` : "reply window closing"}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="crm-muted">Everyone who wrote has an answer.</p>
          )}
        </div>
        <div className="crm-briefing-section">
          <h3>
            Overdue follow-ups <span className="crm-count">{overdue.length}</span>
          </h3>
          {overdue.length ? (
            <ul>
              {overdue.slice(0, 5).map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => setSelected(l.id)}>
                    <strong>{l.name}</strong>
                    <small>due {ago(l.follow_up!, now)}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="crm-muted">No follow-ups overdue.</p>
          )}
        </div>
        <div className="crm-briefing-section">
          <h3>
            Going cold <span className="crm-count">{cold.length}</span>
          </h3>
          {cold.length ? (
            <ul>
              {cold.map(({ lead, days }) => (
                <li key={lead.id}>
                  <button type="button" onClick={() => setSelected(lead.id)}>
                    <strong>{lead.name}</strong>
                    <small>no contact for {days} days</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="crm-muted">Every lead has been contacted this week.</p>
          )}
        </div>
      </div>

      {overnight && (
        <div className="crm-briefing-ai">
          <strong>AI in the last 24 hours</strong>
          <span>
            {overnight.replies_sent} automatic {overnight.replies_sent === 1 ? "reply" : "replies"} sent
          </span>
          <span>{plural(overnight.followups_sent, "follow-up")} sent</span>
          <span>{plural(overnight.insights_updated, "lead")} re-scored</span>
          {handed.length > 0 && (
            <span className="crm-briefing-handed">
              Handed to you:{" "}
              {handed.slice(0, 3).map((h, i) => (
                <button key={h.conversation_id + h.at} type="button" onClick={() => setSelected(h.lead_id)}>
                  {leadName(h.lead_id)}
                  {i < Math.min(handed.length, 3) - 1 ? "," : ""}
                </button>
              ))}
              {handed.length > 3 && ` +${handed.length - 3} more`}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
