"use client";
import { useState } from "react";
export function AISettings({ role, demo }: { role: string; demo: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [knowledge, setKnowledge] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [autoReady, setAutoReady] = useState(false);
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
            <h2>AI assistant</h2>
            <p>
              Your workspace owner or admin can configure company knowledge and
              enable reply drafts.
            </p>
          </div>
        </div>
      </section>
    );
  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/crm/ai", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setKnowledge(result.settings.knowledge);
      setEnabled(result.settings.drafts_enabled);
      setReady(result.provider_ready);
      setAutomatic(Boolean(result.settings.auto_enabled));
      setAutoReady(Boolean(result.automation_ready));
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
          <h2>AI assistant</h2>
          <p>
            Prepare replies using your own company and property information.
          </p>
        </div>
        <button disabled={busy || demo} onClick={() => void load()}>
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
                const response = await fetch("/api/crm/ai", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "settings",
                    knowledge,
                    enabled,
                  }),
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
            <label>
              Company, properties and FAQs
              <textarea
                value={knowledge}
                onChange={(e) => setKnowledge(e.target.value)}
                maxLength={12000}
                rows={12}
                placeholder="Add your company introduction, areas served, property details, current prices, availability, office hours, contact details and FAQs. Keep these facts up to date."
              />
            </label>
            <small>
              {knowledge.length.toLocaleString()} / 12,000 characters. Include
              only information you want used in customer replies.
            </small>
            <label className="crm-ai-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />{" "}
              Allow team members to generate reply drafts
            </label>
            <p>
              Drafts consume your shared AI allowance. Replies require review
              unless you separately enable automatic replies below.
            </p>
            {!ready && (
              <p>
                AI provider setup is pending. You can save your knowledge now.
              </p>
            )}
            <button className="crm-primary" disabled={busy}>
              {busy ? "Saving…" : "Save assistant settings"}
            </button>
          </form>
        )}
        {loaded && (
          <div className="crm-ai-settings">
            <h3>Automatic WhatsApp replies</h3>
            <p>
              {automatic
                ? "Enabled for new incoming messages. Uses your shared AI and messaging allowances."
                : "Off. Replies require your review and approval."}
            </p>
            <p>
              Enabling this authorizes the assistant to send replies without
              reviewing each one. Human takeover pauses a conversation.
              Uncertain responses and failures are handed to your team.
              With Pro Plus and a connected agent calendar, a clear request for an available site-visit time can also be booked automatically.
            </p>
            {!autoReady && (
              <p>The automatic reply worker is not enabled yet.</p>
            )}
            {autoReady && !workerHealthy && <p role="alert">The reply worker is not reporting healthy activity. Automatic replies may be delayed; contact your administrator.</p>}
            <button
              disabled={busy || (!automatic && (!autoReady || !ready))}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await fetch("/api/crm/ai", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "automation",
                      enabled: !automatic,
                    }),
                  });
                  const result = await r.json();
                  if (!r.ok) throw new Error(result.error);
                  setAutomatic(!automatic);
                  setMessage(
                    automatic
                      ? "Automatic replies disabled."
                      : "Automatic replies enabled for new messages.",
                  );
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Unable to change automation.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {automatic
                ? "Disable automatic replies"
                : "Enable automatic replies without review"}
            </button>
            {jobs.length > 0 && (
              <>
                <h4>Recent automatic reply activity</h4>
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
