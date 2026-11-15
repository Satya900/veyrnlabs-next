"use client";
import { useCallback, useEffect, useState } from "react";
import { crmFetch } from "./activity";
import { useWorkspaceContext } from "./context";

type Visit = {
  id: string;
  starts_at: string;
  status: "scheduled" | "done" | "no_show" | "cancelled";
  note: string;
  feedback: string;
  project_id: string | null;
  booking_id: string | null;
};
type Message = { visit_id: string; visit_kind: "day" | "soon" | "feedback"; status: string };

const STATUS: Record<Visit["status"], string> = {
  scheduled: "Scheduled",
  done: "Done",
  no_show: "Didn't come",
  cancelled: "Cancelled",
};
const SENT: Record<Message["visit_kind"], string> = {
  day: "Reminder sent the evening before",
  soon: "Reminder sent 2 hours before",
  feedback: "Feedback asked",
};
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm".
const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Site visits for one lead: schedule one (any plan, no calendar needed), then mark how it went. */
export function SiteVisits({ leadId, projectId, canAct }: { leadId: string; projectId?: string | null; canAct: boolean }) {
  const { data, reload, now } = useWorkspaceContext();
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const projects = (data.projects ?? []).filter((p) => !p.archived || p.id === projectId);
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name;

  const fetchVisits = useCallback(
    () =>
      crmFetch(`/api/crm/visits?lead=${leadId}`, { cache: "no-store" }).then(async (res) => {
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        return result as { visits: Visit[]; messages: Message[] };
      }),
    [leadId],
  );
  const show = (result: { visits: Visit[]; messages: Message[] }) => {
    setVisits(result.visits);
    setMessages(result.messages);
  };
  const load = () => fetchVisits().then(show);
  useEffect(() => {
    let cancelled = false;
    fetchVisits()
      .then((result) => {
        if (!cancelled) show(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Couldn't load site visits.");
        setVisits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchVisits]);

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await crmFetch("/api/crm/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setMoving(null);
      await Promise.all([load(), reload()]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const tomorrow = new Date(now + 86_400_000);
  tomorrow.setHours(11, 0, 0, 0);

  return (
    <div className="crm-site-visits">
      <h3>Site visits</h3>
      {visits === null && <p className="crm-muted">Loading…</p>}
      {visits?.length ? (
        <ul>
          {visits.map((v) => {
            const sent = messages.filter((m) => m.visit_id === v.id && m.status === "sent");
            return (
              <li key={v.id}>
                <div className="crm-site-visit-head">
                  <strong>{when(v.starts_at)}</strong>
                  <span className={`crm-badge${v.status === "done" ? " won" : v.status === "scheduled" ? "" : " lost"}`}>
                    {STATUS[v.status]}
                  </span>
                </div>
                <small>
                  {[projectName(v.project_id), v.booking_id ? "Google Calendar" : "", v.note].filter(Boolean).join(" · ")}
                </small>
                {sent.length > 0 && <small>✓ {sent.map((m) => SENT[m.visit_kind]).join(" · ")}</small>}
                {v.feedback && <blockquote>&ldquo;{v.feedback}&rdquo;</blockquote>}
                {canAct && v.status === "scheduled" && moving !== v.id && (
                  <div className="crm-site-visit-actions">
                    <button type="button" disabled={busy} onClick={() => void post({ action: "update", visit: v.id, status: "done" })}>
                      Visit done
                    </button>
                    <button type="button" disabled={busy} onClick={() => void post({ action: "update", visit: v.id, status: "no_show" })}>
                      Didn&apos;t come
                    </button>
                    {!v.booking_id && (
                      <>
                        <button type="button" disabled={busy} onClick={() => setMoving(v.id)}>
                          Change time
                        </button>
                        <button type="button" disabled={busy} onClick={() => void post({ action: "update", visit: v.id, status: "cancelled" })}>
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                )}
                {moving === v.id && (
                  <form
                    className="crm-site-visit-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const value = String(new FormData(e.currentTarget).get("when") ?? "");
                      void post({ action: "update", visit: v.id, status: "scheduled", startsAt: new Date(value).toISOString() });
                    }}
                  >
                    <input type="datetime-local" name="when" required defaultValue={localInput(new Date(v.starts_at))} aria-label="New visit time" />
                    <button className="crm-primary" disabled={busy}>Save</button>
                    <button type="button" onClick={() => setMoving(null)}>Keep</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : visits ? (
        <p className="crm-muted">No visits yet.</p>
      ) : null}
      {canAct && (
        <form
          className="crm-site-visit-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const ok = await post({
              action: "schedule",
              lead: leadId,
              startsAt: new Date(String(f.get("when"))).toISOString(),
              project: f.get("project") || null,
              note: f.get("note"),
            });
            if (ok) form.reset();
          }}
        >
          <input type="datetime-local" name="when" required defaultValue={localInput(tomorrow)} aria-label="Visit date and time" />
          {projects.length > 0 && (
            <select name="project" defaultValue={projectId ?? ""} aria-label="Project">
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <input name="note" maxLength={500} placeholder="Note (optional)" aria-label="Visit note" />
          <button className="crm-primary" disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : "Schedule visit"}
          </button>
        </form>
      )}
      {error && <p role="alert" className="crm-error">{error}</p>}
      <small className="crm-muted">
        The customer gets WhatsApp reminders the evening before and 2 hours before, and a feedback
        question after, once visit messages are set up in Settings → WhatsApp follow-ups.
      </small>
    </div>
  );
}
