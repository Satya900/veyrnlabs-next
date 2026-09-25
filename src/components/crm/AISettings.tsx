"use client";
import { useState } from "react";
export function AISettings({ role, demo }: { role: string; demo: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [knowledge, setKnowledge] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
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
              Drafts consume your shared AI allowance. This knowledge is also
              used to draft automatic follow-up emails, below.
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
      </div>
    </section>
  );
}
