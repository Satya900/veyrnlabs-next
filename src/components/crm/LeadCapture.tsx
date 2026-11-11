"use client";
import { useState } from "react";
import { crmFetch } from "./activity";

type State = {
  capture: { token: string; enabled: boolean; welcome_template_id: string | null; assign_to: string | null } | null;
  templates: { id: string; label: string; body: string }[];
  members: { id: string; name: string; role: string }[];
  recent: { id: string; lead_id: string | null; name: string | null; status: string; source: string; created_at: string }[];
  week: { created: number; existing: number };
  gupshupConnected: boolean;
};

// Worded as a reply to the customer's own enquiry, so WhatsApp can approve it as Utility.
const WELCOME =
  "Hi {{1}}, thank you for your enquiry about {{2}} with {{3}}. I'm {{4}} and I'll help you with details, prices and site visits. Reply here anytime.";
const FIELDS = "name, phone, email, looking_for, budget, location, message, source";
const STATUS: Record<string, string> = { created: "New lead", existing: "Added to existing lead", ignored: "Ignored (repeat)" };
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function Copy({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="crm-copy-field">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function LeadCapture({ role, demo }: { role: string; demo: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  if (role === "team") return null;

  async function load() {
    setBusy(true);
    setError("");
    try {
      const res = await crmFetch("/api/crm/lead-capture", { cache: "no-store" });
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
      const res = await crmFetch("/api/crm/lead-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setMessage(done);
      setBusy(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
      setBusy(false);
    }
  }

  const capture = state?.capture;
  const formLink = capture ? `${origin}/f/${capture.token}` : "";
  const webhook = capture ? `${origin}/api/leads/${capture.token}` : "";
  const embed = capture
    ? `<iframe src="${formLink}?embed=1&source=Website" style="width:100%;max-width:520px;height:640px;border:0" title="Enquiry form"></iframe>`
    : "";

  return (
    <section className="crm-panel">
      <div className="crm-panel-heading">
        <div>
          <h2>Lead capture</h2>
          <p>
            Bring every enquiry into the CRM automatically: your own enquiry form, your website, and
            Facebook / Instagram Lead Ads, Google Ads or portals through Zapier, Pabbly or Make.
          </p>
        </div>
        <button disabled={busy || demo} onClick={() => void load()}>
          {state ? "Refresh" : "Set up"}
        </button>
      </div>
      <div className="crm-settings-body crm-capture">
        {demo && <p className="crm-muted">Available in your live workspace.</p>}
        {!demo && !state && !error && (
          <p className="crm-muted">
            New enquiries become leads in seconds, are assigned to your team, and get an instant
            WhatsApp welcome from your number. Someone who enquires twice is added to their existing lead.
          </p>
        )}
        {error && <p role="alert" className="crm-error">{error}</p>}
        {message && <p role="status" className="crm-success">{message}</p>}

        {state && !capture?.enabled && (
          <div className="crm-capture-off">
            <p>{capture ? "Lead capture is off. Your links don't accept enquiries." : "Get your enquiry form and webhook link."}</p>
            <button className="crm-primary" disabled={busy} onClick={() => void post({ action: "enable" }, "Lead capture is on.")}>
              Turn on lead capture
            </button>
          </div>
        )}

        {state && capture?.enabled && (
          <>
            <p className="crm-capture-stats">
              <strong>{state.week.created}</strong> new lead{state.week.created === 1 ? "" : "s"} ·{" "}
              <strong>{state.week.existing}</strong> repeat enquir{state.week.existing === 1 ? "y" : "ies"} in the last 7 days
            </p>

            <div className="crm-provider-step">
              <span className="crm-provider-step-number">1</span>
              <div>
                <strong>Your enquiry form</strong>
                <small>
                  Share it in your Instagram bio, WhatsApp status, ads or as a QR code. Add
                  <code>?source=Instagram</code> to the link to see where each lead came from.
                </small>
                <Copy value={formLink} label="Enquiry form link" />
                <a href={formLink} target="_blank" rel="noopener" className="crm-capture-open">Open form ↗</a>
              </div>
            </div>

            <div className="crm-provider-step">
              <span className="crm-provider-step-number">2</span>
              <div>
                <strong>On your website</strong>
                <small>Paste this where the form should appear.</small>
                <Copy value={embed} label="Website embed code" />
              </div>
            </div>

            <div className="crm-provider-step">
              <span className="crm-provider-step-number">3</span>
              <div>
                <strong>Facebook &amp; Instagram Lead Ads, Google Ads, portals</strong>
                <small>
                  In Zapier, Pabbly Connect or Make: trigger <b>New lead</b> (Facebook Lead Ads, Google
                  Ads, Google Sheets, Gmail for portal emails…), then action <b>Webhook → POST</b> to this
                  link, as JSON or form data. Fields we read: <code>{FIELDS}</code>. Any other fields
                  are kept in the lead&apos;s notes.
                </small>
                <Copy value={webhook} label="Webhook link" />
              </div>
            </div>

            <form
              className="crm-provider-step"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void post(
                  { action: "save", welcomeTemplateId: form.get("welcome"), assignTo: form.get("assign") },
                  "Saved.",
                );
              }}
            >
              <span className="crm-provider-step-number">4</span>
              <div>
                <strong>New leads</strong>
                <label>
                  Assign to
                  <select name="assign" defaultValue={capture.assign_to ?? ""} key={capture.assign_to}>
                    <option value="">Nobody (unassigned)</option>
                    {state.members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}{m.role === "owner" ? " (owner)" : ""}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Instant WhatsApp welcome
                  <select name="welcome" defaultValue={capture.welcome_template_id ?? ""} key={capture.welcome_template_id}>
                    <option value="">Don&apos;t send</option>
                    {state.templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </label>
                <small>
                  {state.gupshupConnected
                    ? "Sent from your number within seconds of the enquiry. When they reply, your AI takes over the chat."
                    : "Connect WhatsApp through Gupshup to send welcomes."}{" "}
                  To add a welcome template, create it in Gupshup (category <b>Utility</b>) and add it
                  under WhatsApp follow-ups below. Suggested text:
                </small>
                <Copy value={WELCOME} label="Suggested welcome template" />
                <small>Variables: 1 lead&apos;s first name · 2 what they enquired about · 3 your business name · 4 assigned agent&apos;s name.</small>
                <button type="submit" className="crm-primary" disabled={busy}>Save</button>
              </div>
            </form>

            {state.recent.length > 0 && (
              <div className="crm-capture-recent">
                <strong>Latest enquiries</strong>
                <ul>
                  {state.recent.map((e) => (
                    <li key={e.id}>
                      <span>{e.name ?? "—"}</span>
                      <small>{e.source} · {STATUS[e.status] ?? e.status} · {when(e.created_at)}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="crm-capture-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Create new links? The current form, embed and webhook stop working until you update them everywhere."))
                    void post({ action: "rotate" }, "New links created. Update them wherever you used the old ones.");
                }}
              >
                Create new links
              </button>
              <button type="button" disabled={busy} onClick={() => void post({ action: "disable" }, "Lead capture is off.")}>
                Turn off
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
