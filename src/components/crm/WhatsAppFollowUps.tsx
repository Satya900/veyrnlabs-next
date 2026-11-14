"use client";
import { useState } from "react";
import { crmFetch } from "./activity";

type Template = { id: string; label: string; provider_template_id: string; body: string; params: string[] };
type Job = { id: string; lead_id: string; status: string; reason: string; created_at: string };
type State = {
  settings: {
    enabled: boolean;
    template_id: string | null;
    country_code: string;
    visit_reminder_template_id?: string | null;
    visit_feedback_template_id?: string | null;
  };
  templates: Template[];
  recent: Job[];
  gupshupConnected: boolean;
};

const SOURCES: Record<string, string> = {
  lead_first_name: "Lead's first name",
  lead_name: "Lead's full name",
  agent_name: "Assigned agent's name",
  business_name: "Your business name",
  service: "What they enquired about",
  follow_up_date: "Follow-up date",
  visit_date: "Site visit date",
  visit_time: "Site visit time",
  project_name: "Site visit project",
};
// Worded as a reply to the customer's own enquiry, so WhatsApp can approve it as Utility.
const SUGGESTED = {
  label: "Enquiry follow-up",
  body: "Hi {{1}}, this is {{2}} from {{3}}. Following up on your enquiry about {{4}}. Would you like to schedule a site visit or get more details? Just reply here.",
  params: ["lead_first_name", "agent_name", "business_name", "service"],
};
// Site visit messages, worded as service updates so WhatsApp approves them as Utility.
const VISIT_TEMPLATES = [
  {
    label: "Site visit reminder",
    body: "Hi {{1}}, a reminder of your site visit to {{2}} on {{3}} at {{4}}. Reply here if you need directions or want to change the time.",
    params: ["lead_first_name", "project_name", "visit_date", "visit_time"],
    use: "Sent the evening before (6 PM) and 2 hours before the visit.",
  },
  {
    label: "Site visit feedback",
    body: "Hi {{1}}, thank you for your interest in {{2}}. How was your site visit? If you couldn't make it, just reply and we'll find a new time.",
    params: ["lead_first_name", "project_name"],
    use: "Sent about 3 hours after the visit. Their reply is saved on the visit.",
  },
];
const STATUS: Record<string, string> = {
  processing: "Sending",
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
  needs_human: "Needs attention",
};

export function WhatsAppFollowUps({ role, demo }: { role: string; demo: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [label, setLabel] = useState(SUGGESTED.label);
  const [body, setBody] = useState(SUGGESTED.body);
  const [params, setParams] = useState<string[]>(SUGGESTED.params);
  const [testing, setTesting] = useState<string | null>(null);
  if (role === "team") return null;
  const variables = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

  async function load() {
    setBusy(true);
    setError("");
    try {
      const res = await crmFetch("/api/crm/whatsapp/followups", { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setState(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load.");
    } finally {
      setBusy(false);
    }
  }
  async function post(payload: Record<string, unknown>, done: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await crmFetch("/api/crm/whatsapp/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setMessage(done);
      setBusy(false);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
      setBusy(false);
      return false;
    }
  }

  return (
    <section className="crm-panel">
      <div className="crm-panel-heading">
        <div>
          <h2>WhatsApp follow-ups</h2>
          <p>Message leads automatically from your number when their follow-up date passes.</p>
        </div>
        <button disabled={busy || demo} onClick={() => void load()}>
          {state ? "Refresh" : "Set up"}
        </button>
      </div>
      <div className="crm-settings-body crm-followups">
        {demo && <p className="crm-muted">Available in your live workspace.</p>}
        {!demo && !state && !error && (
          <p className="crm-muted">
            When a lead&apos;s follow-up is due and nobody has called, noted or chatted since,
            the CRM sends one approved WhatsApp message from your number.
          </p>
        )}
        {error && <p role="alert" className="crm-error">{error}</p>}
        {state && !state.gupshupConnected && (
          <p className="crm-plan-notice">Connect WhatsApp through Gupshup first (WhatsApp connection, below).</p>
        )}
        {state && (
          <>
            <div className="crm-provider-step">
              <span className="crm-provider-step-number">1</span>
              <div>
                <strong>Create the template in Gupshup</strong>
                <small>
                  Gupshup → your app → Templates → New template. Category <b>Utility</b>, language
                  English, and this text. WhatsApp usually approves it within minutes.
                </small>
                <div className="crm-copy-field">
                  <input readOnly value={SUGGESTED.body} aria-label="Suggested template text" onFocus={(e) => e.target.select()} />
                  <button type="button" onClick={() => void navigator.clipboard.writeText(SUGGESTED.body)}>
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <form
              className="crm-provider-step"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const ok = await post(
                  {
                    action: "saveTemplate",
                    label: form.get("label"),
                    templateId: form.get("templateId"),
                    body,
                    params: params.slice(0, variables),
                  },
                  "Template added.",
                );
                if (ok) {
                  (e.target as HTMLFormElement).reset();
                  setLabel(SUGGESTED.label);
                  setBody(SUGGESTED.body);
                  setParams(SUGGESTED.params);
                }
              }}
            >
              <span className="crm-provider-step-number">2</span>
              <div className="crm-followup-form">
                <strong>Add it here once it&apos;s approved</strong>
                <small>Copy the template ID from Gupshup → Templates, and paste the text exactly as approved.</small>
                <label>
                  Name
                  <input name="label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} required />
                </label>
                <label>
                  Gupshup template ID
                  <input name="templateId" required autoComplete="off" placeholder="e.g. 5f2449fd-e4d6-4d02-…" />
                </label>
                <label className="crm-followup-wide">
                  Template text
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1024} required />
                </label>
                {Array.from({ length: Math.min(variables, 10) }, (_, i) => (
                  <label key={i}>
                    {`{{${i + 1}}}`} is filled with
                    <select
                      value={params[i] ?? "lead_first_name"}
                      onChange={(e) => {
                        const next = [...params];
                        next[i] = e.target.value;
                        setParams(next);
                      }}
                    >
                      {Object.entries(SOURCES).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <button className="crm-primary" disabled={busy} aria-busy={busy}>Add template</button>
              </div>
            </form>

            {state.templates.length > 0 && (
              <ul className="crm-team-list">
                {state.templates.map((t) => (
                  <li key={t.id} className="crm-team-row crm-template-row">
                    <span className="crm-team-name">
                      <strong>{t.label}</strong>
                      <small>{t.body}</small>
                    </span>
                    <span className="crm-template-actions">
                      <button
                        type="button"
                        disabled={busy || !state.gupshupConnected}
                        aria-expanded={testing === t.id}
                        onClick={() => setTesting(testing === t.id ? null : t.id)}
                      >
                        Send test
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void post({ action: "deleteTemplate", id: t.id }, "Template removed.")}
                      >
                        Remove
                      </button>
                    </span>
                    {testing === t.id && (
                      <form
                        className="crm-template-test"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const to = new FormData(e.currentTarget).get("to");
                          const ok = await post(
                            { action: "testTemplate", id: t.id, to },
                            "Test sent. It should arrive on that WhatsApp within a minute.",
                          );
                          if (ok) setTesting(null);
                        }}
                      >
                        <small>
                          Sends this template once, filled with sample details (&quot;Test&quot;, your
                          name, your business). It works even if that number has never messaged you.
                        </small>
                        <div className="crm-copy-field">
                          <input
                            name="to"
                            inputMode="tel"
                            autoComplete="off"
                            placeholder="Your WhatsApp number, e.g. 9876543210"
                            aria-label="WhatsApp number for the test"
                            required
                          />
                          <button className="crm-primary" disabled={busy} aria-busy={busy}>
                            {busy ? "Sending…" : "Send"}
                          </button>
                        </div>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form
              className="crm-provider-step"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void post(
                  {
                    action: "saveSettings",
                    enabled: form.get("enabled") === "on",
                    templateId: form.get("templateId"),
                    countryCode: form.get("countryCode"),
                  },
                  "Follow-up settings saved.",
                );
              }}
            >
              <span className="crm-provider-step-number">3</span>
              <fieldset className="crm-followup-form" disabled={role !== "owner" || busy}>
                <strong>Turn on automatic follow-ups</strong>
                <small>
                  One message per follow-up date, only for follow-ups due in the last 7 days, never to
                  anyone who sent STOP (unless they later sent START), and within your plan&apos;s WhatsApp allowance.
                </small>
                <label>
                  Template to send
                  <select name="templateId" defaultValue={state.settings.template_id ?? ""} key={state.settings.template_id ?? "none"}>
                    <option value="">Choose a template</option>
                    {state.templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Country code for 10-digit numbers
                  <input name="countryCode" defaultValue={state.settings.country_code} inputMode="numeric" maxLength={4} />
                </label>
                <label className="crm-followup-toggle crm-followup-wide">
                  <input type="checkbox" name="enabled" defaultChecked={state.settings.enabled} key={String(state.settings.enabled)} />
                  Send WhatsApp follow-ups automatically
                </label>
                <button className="crm-primary">Save</button>
                {role !== "owner" && <small>Only the workspace owner can change this.</small>}
              </fieldset>
            </form>

            <form
              className="crm-provider-step"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void post(
                  {
                    action: "saveVisitMessages",
                    reminderTemplateId: form.get("reminder"),
                    feedbackTemplateId: form.get("feedback"),
                  },
                  "Site visit messages saved.",
                );
              }}
            >
              <span className="crm-provider-step-number">4</span>
              <fieldset className="crm-followup-form" disabled={busy}>
                <strong>Site visit reminders and feedback</strong>
                <small>
                  For visits scheduled on a lead. Create these two templates in Gupshup (Utility), add
                  them in step 2 with <b>Use this text</b>, then choose them here.
                </small>
                {VISIT_TEMPLATES.map((t) => (
                  <div key={t.label} className="crm-followup-wide crm-visit-template">
                    <small>
                      <b>{t.label}.</b> {t.use}
                    </small>
                    <div className="crm-copy-field">
                      <input readOnly value={t.body} aria-label={`${t.label} text`} onFocus={(e) => e.target.select()} />
                      <button type="button" onClick={() => void navigator.clipboard.writeText(t.body)}>
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLabel(t.label);
                          setBody(t.body);
                          setParams(t.params);
                          setMessage(`"${t.label}" is filled in step 2. Paste its Gupshup template ID there and add it.`);
                        }}
                      >
                        Use this text
                      </button>
                    </div>
                  </div>
                ))}
                <label>
                  Reminder template
                  <select name="reminder" defaultValue={state.settings.visit_reminder_template_id ?? ""} key={`r${state.settings.visit_reminder_template_id ?? ""}`}>
                    <option value="">Off</option>
                    {state.templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Feedback template
                  <select name="feedback" defaultValue={state.settings.visit_feedback_template_id ?? ""} key={`f${state.settings.visit_feedback_template_id ?? ""}`}>
                    <option value="">Off</option>
                    {state.templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </label>
                <button className="crm-primary">Save</button>
              </fieldset>
            </form>

            {state.recent.length > 0 && (
              <div className="crm-followup-recent">
                <strong>Recent follow-ups</strong>
                <ul className="crm-team-list">
                  {state.recent.map((job) => (
                    <li key={job.id} className="crm-team-row">
                      <span className="crm-team-name">
                        <strong>{new Date(job.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</strong>
                        {job.reason && <small>{job.reason}</small>}
                      </span>
                      <span className={job.status === "sent" ? "crm-badge won" : "crm-badge"}>{STATUS[job.status] ?? job.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {message && <p role="status" className="crm-success">{message}</p>}
      </div>
    </section>
  );
}
