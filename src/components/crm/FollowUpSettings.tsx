"use client";
import { useState } from "react";
export function FollowUpSettings({ role, demo }: { role: string; demo: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [workerHealthy, setWorkerHealthy] = useState(false);
  const [jobs, setJobs] = useState<
    { id: string; status: string; reason: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  if (role === "team")
    return (
      <section className="crm-panel crm-plan-usage">
        <div className="crm-panel-heading">
          <div>
            <h2>Automatic follow-ups</h2>
            <p>
              Your workspace owner or admin can enable email nudges
              for overdue leads.
            </p>
          </div>
        </div>
      </section>
    );
  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/crm/followups", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setEnabled(Boolean(result.enabled));
      setReady(Boolean(result.automation_ready));
      setWorkerHealthy(Boolean(result.worker_healthy));
      setJobs(result.jobs ?? []);
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
          <h2>Automatic follow-ups</h2>
          <p>
            Nudge leads by email when their follow-up date passes
            with no reply.
          </p>
        </div>
        <button disabled={busy || demo} onClick={() => void load()}>
          {busy ? "Loading…" : loaded ? "Reload" : "Configure follow-ups"}
        </button>
      </div>
      <div className="crm-settings-body">
        {demo && <p>Configure follow-ups in your live workspace.</p>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {loaded && (
          <div className="crm-ai-settings">
            <p>
              {enabled
                ? "Enabled. A lead with a passed follow-up date and no logged activity since gets an AI-drafted email, using its knowledge from the AI assistant above."
                : "Off. Leads with an overdue follow-up only show in your Follow-ups list."}
            </p>
            <p>
              Uses the same company knowledge as the AI assistant above &mdash;
              save that first. Enabling this sends messages automatically,
              without review.
            </p>
            {!ready && (
              <p>
                The follow-up worker or the email channel is not
                configured yet.
              </p>
            )}
            {ready && !workerHealthy && (
              <p role="alert">
                The follow-up worker is not reporting healthy activity.
                Messages may be delayed; contact your administrator.
              </p>
            )}
            <button
              disabled={busy || (!enabled && !ready)}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await fetch("/api/crm/followups", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: !enabled }),
                  });
                  const result = await r.json();
                  if (!r.ok) throw new Error(result.error);
                  setEnabled(!enabled);
                  setMessage(
                    enabled
                      ? "Automatic follow-ups disabled."
                      : "Automatic follow-ups enabled for overdue leads.",
                  );
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Unable to change automation.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {enabled ? "Disable automatic follow-ups" : "Enable automatic follow-ups"}
            </button>
            {jobs.length > 0 && (
              <>
                <h4>Recent follow-up activity</h4>
                <ul>
                  {jobs.map((job) => (
                    <li key={job.id}>
                      <strong>{job.status.replaceAll("_", " ")}</strong>
                      {job.reason ? `: ${job.reason}` : ""}
                    </li>
                  ))}
                </ul>
                <small>Reload settings to refresh activity.</small>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
