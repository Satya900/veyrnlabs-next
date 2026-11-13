"use client";
import { crmFetch } from "./activity";
import { useState } from "react";
import { useWorkspaceContext } from "./context";
type AutoAccess = {
  plan: "pro" | "pro_plus" | null;
  allowed: boolean;
  can_start_trial: boolean;
  trial_ends_at: string | null;
};
type AutoJob = { id: string; status: string; reason: string; created_at: string };
const JOB_STATUS: Record<string, string> = {
  queued: "Waiting",
  processing: "Replying",
  complete: "Replied",
  skipped: "Skipped",
  needs_human: "Handed to team",
  failed: "Failed",
};
export function AISettings({ role, demo }: { role: string; demo: boolean }) {
  const { changeView } = useWorkspaceContext();
  const [loaded, setLoaded] = useState(false);
  const [projects, setProjects] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [auto, setAuto] = useState(false);
  const [autoReady, setAutoReady] = useState(false);
  const [jobs, setJobs] = useState<AutoJob[]>([]);
  const [access, setAccess] = useState<AutoAccess | null>(null);
  const [newChats, setNewChats] = useState(true);
  // Two-step confirm for the bulk switch (no browser dialogs).
  const [confirmAll, setConfirmAll] = useState<"off" | "on" | null>(null);
  if (role === "team")
    return (
      <section className="crm-panel crm-plan-usage">
        <div className="crm-panel-heading">
          <div>
            <h2>AI assistant</h2>
            <p>
              The AI answers from your Projects. Your workspace owner or admin can
              enable reply drafts.
            </p>
          </div>
        </div>
      </section>
    );
  async function automate(next: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await crmFetch("/api/crm/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "automation", enabled: next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setAuto(next);
      // Turning it on may have started the Pro trial; reload to show its end date.
      if (next) void load();
      setMessage(
        next
          ? "Automatic replies are on. New customer messages get an answer within seconds."
          : "Automatic replies are off. Customers get replies only from your team.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change automatic replies.");
    } finally {
      setBusy(false);
    }
  }
  async function switchAllChats(enabled: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await crmFetch("/api/crm/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "allChats", enabled }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(
        enabled
          ? `AI is on for ${result.changed} more chat${result.changed === 1 ? "" : "s"}.`
          : `AI is off for ${result.changed} more chat${result.changed === 1 ? "" : "s"}. Switch it on in the inbox for chats that are real leads.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change AI for all chats.");
    } finally {
      setBusy(false);
      setConfirmAll(null);
    }
  }
  async function changeNewChats(next: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await crmFetch("/api/crm/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "newChats", enabled: next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setNewChats(next);
      setMessage(
        next
          ? "New chats from unknown numbers start with AI on."
          : "New chats from unknown numbers start with AI off. Turn it on per chat for real leads.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change the setting.");
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await crmFetch("/api/crm/ai", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setProjects(Number(result.projects) || 0);
      setEnabled(result.settings.drafts_enabled);
      setReady(result.provider_ready);
      setAuto(Boolean(result.settings.auto_enabled));
      setAutoReady(Boolean(result.automation_ready));
      setJobs(result.jobs ?? []);
      setAccess(result.auto_access ?? null);
      setNewChats(result.settings.ai_new_chats ?? true);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load settings.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="crm-panel crm-plan-usage">
      <div className="crm-panel-heading">
        <div>
          <h2>AI assistant</h2>
          <p>
            Replies and suggestions use your Projects: prices, sizes, availability,
            possession, RERA and brochures.
          </p>
        </div>
        <button aria-busy={busy} disabled={busy || demo} onClick={() => void load()}>
          {busy ? "Loading…" : loaded ? "Reload" : "Configure assistant"}
        </button>
      </div>
      <div className="crm-settings-body">
        {demo && <p>Configure the assistant in your live workspace.</p>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {loaded && (
          <form
            className="crm-ai-settings"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              setMessage("");
              try {
                const response = await crmFetch("/api/crm/ai", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "settings", enabled }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                setMessage("Assistant settings saved. No messages were sent.");
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Unable to save.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="crm-ai-source">
              <p>
                {projects > 0
                  ? `The AI answers from your ${projects} active project${projects === 1 ? "" : "s"}. Change a price or mark a unit sold out there, and the next reply uses it.`
                  : "Add your first project: the AI answers only from your Projects, and says the agent will confirm anything they don't cover."}
              </p>
              <button type="button" onClick={() => changeView("Projects")}>
                {projects > 0 ? "Open Projects" : "Add a project"}
              </button>
            </div>
            <label className="crm-ai-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />{" "}
              Allow team members to generate reply drafts
            </label>
            <p>
              Drafts consume your shared AI allowance.
            </p>
            {!ready && (
              <p>
                AI provider setup is pending.
              </p>
            )}
            <button aria-busy={busy} className="crm-primary" disabled={busy}>
              {busy ? "Saving…" : "Save assistant settings"}
            </button>
          </form>
        )}
        {loaded && (
          <div className="crm-auto-replies">
            <div className="crm-auto-replies-head">
              <div>
                <strong>Reply to customers automatically</strong>
                <small>
                  The AI answers new WhatsApp messages within seconds, in the customer&apos;s own
                  language, using only your Projects. It hands the chat to your team when a
                  customer asks for a person, wants to negotiate, complains or says STOP, and stays
                  quiet for 30 minutes after anyone on your team replies.
                </small>
              </div>
              <button
                type="button"
                className={auto ? undefined : "crm-primary"}
                disabled={
                  busy ||
                  (role !== "owner" && role !== "admin") ||
                  (!auto && (!autoReady || !enabled || projects === 0 || (access !== null && !access.allowed && !access.can_start_trial)))
                }
                aria-busy={busy}
                onClick={() => void automate(!auto)}
              >
                {auto ? "Turn off" : "Turn on"}
              </button>
            </div>
            {access?.plan === "pro" && (
              <p className="crm-plan-notice">
                {access.can_start_trial
                  ? "AI auto-replies are a Pro Plus feature. Try them free for 14 days on Pro: the trial starts when you turn them on."
                  : access.allowed && access.trial_ends_at
                    ? `Free trial: AI auto-replies are on until ${new Date(access.trial_ends_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}. Upgrade to Pro Plus to keep them.`
                    : "Your 14-day trial of AI auto-replies has ended. Upgrade to Pro Plus to keep the AI replying to customers 24/7."}
              </p>
            )}
            {!auto && !enabled && (
              <small className="crm-muted">Allow reply drafts and save first.</small>
            )}
            {!auto && enabled && projects === 0 && (
              <small className="crm-muted">Add a project first: the AI answers only from your Projects.</small>
            )}
            {!auto && enabled && !autoReady && (
              <small className="crm-muted">
                Not available yet: it needs a connected WhatsApp number and automatic replies switched
                on for the server.
              </small>
            )}
            <label className="crm-ai-check">
              <input
                type="checkbox"
                checked={newChats}
                disabled={busy}
                onChange={(e) => void changeNewChats(e.target.checked)}
              />{" "}
              Turn AI on for new chats from unknown numbers
            </label>
            <small className="crm-muted">
              Using one number for personal and business chats? Untick this so new contacts start
              with AI off, then switch AI on in the chats that are real leads. Leads you add
              yourself always keep AI on. Each chat also has its own AI on/off switch in the inbox.
            </small>
            <div className="crm-ai-bulk">
              {confirmAll ? (
                <>
                  <span>
                    {confirmAll === "off"
                      ? "Turn AI off for every existing chat? No insights, suggestions or automatic replies until you switch chats back on."
                      : "Turn AI on for every existing chat? Insights and automatic replies will run on all of them."}
                  </span>
                  <button
                    type="button"
                    className="crm-primary"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => void switchAllChats(confirmAll === "on")}
                  >
                    {confirmAll === "off" ? "Yes, turn AI off" : "Yes, turn AI on"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirmAll(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span>All existing chats:</span>
                  <button type="button" disabled={busy} onClick={() => setConfirmAll("off")}>
                    Turn AI off for all chats
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirmAll("on")}>
                    Turn AI on for all chats
                  </button>
                </>
              )}
            </div>
            {jobs.length > 0 && (
              <ul className="crm-team-list">
                {jobs.map((job) => (
                  <li key={job.id} className="crm-team-row">
                    <span className="crm-team-name">
                      <strong>
                        {new Date(job.created_at).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </strong>
                      {job.reason && <small>{job.reason}</small>}
                    </span>
                    <span className={job.status === "complete" ? "crm-badge won" : "crm-badge"}>
                      {JOB_STATUS[job.status] ?? job.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
