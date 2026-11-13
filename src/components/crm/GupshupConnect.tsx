"use client";
import { useState } from "react";
import { crmFetch } from "./activity";

type Connection = {
  active: boolean;
  display_phone: string;
  provider?: "meta" | "gupshup";
  provider_app?: string | null;
  provider_app_id?: string | null;
};

/** Owner-only: connect the workspace's own Gupshup app, then wire its callback and test it. */
export function GupshupConnect({
  connection,
  callbackUrl,
  ready,
  onChanged,
}: {
  connection?: Connection | null;
  callbackUrl: string | null;
  ready: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const connected = connection?.active && connection.provider === "gupshup";

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await crmFetch("/api/crm/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      return result as { message?: string };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!ready)
    return (
      <p className="crm-muted">
        WhatsApp connections aren&apos;t enabled on this server yet. Contact support.
      </p>
    );

  if (connected)
    return (
      <div className="crm-provider">
        <p>
          <strong>Connected through Gupshup</strong>
          <small>
            App {connection?.provider_app} · {connection?.display_phone}
          </small>
        </p>
        {callbackUrl && (
          <div className="crm-provider-step">
            <span className="crm-provider-step-number">1</span>
            <div>
              <strong>Paste this callback URL into Gupshup</strong>
              <small>
                Gupshup → your app → Webhooks → Callback URL → Set. Keep it private: it lets
                Gupshup deliver your messages here.
              </small>
              <div className="crm-copy-field">
                <input readOnly value={callbackUrl} onFocus={(e) => e.target.select()} aria-label="Callback URL" />
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(callbackUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        )}
        <form
          className="crm-provider-step"
          onSubmit={async (e) => {
            e.preventDefault();
            const to = String(new FormData(e.currentTarget).get("to") ?? "");
            const result = await post({ action: "gupshupTest", to });
            if (result) setMessage(result.message ?? "Sent.");
          }}
        >
          <span className="crm-provider-step-number">2</span>
          <div>
            <strong>Send a test message</strong>
            <small>
              First send &quot;hi&quot; from your phone to {connection?.display_phone} (WhatsApp
              only allows replies within 24 hours of a customer&apos;s message), then enter
              your number here.
            </small>
            <div className="crm-copy-field">
              <input name="to" inputMode="tel" placeholder="919876543210" aria-label="Your WhatsApp number" required />
              <button className="crm-primary" disabled={busy} aria-busy={busy}>
                {busy ? "Sending…" : "Send test"}
              </button>
            </div>
          </div>
        </form>
        <form
          className="crm-provider-step"
          onSubmit={async (e) => {
            e.preventDefault();
            const appId = String(new FormData(e.currentTarget).get("appId") ?? "");
            const result = await post({ action: "gupshupAppId", appId });
            if (result) {
              setMessage(result.message ?? "Saved.");
              await onChanged();
            }
          }}
        >
          <span className="crm-provider-step-number">3</span>
          <div>
            <strong>Blue ticks while the AI replies</strong>
            <small>
              Customers see their message turn blue within seconds, so they know it was read.
              Copy the App ID from Gupshup → your app (the long code under the app name). It
              isn&apos;t a password and can&apos;t send messages.
            </small>
            <div className="crm-copy-field">
              <input
                name="appId"
                defaultValue={connection?.provider_app_id ?? ""}
                autoComplete="off"
                spellCheck={false}
                placeholder="1b73dad6-1234-5678-9abc-60981da19f70"
                aria-label="Gupshup App ID"
              />
              <button className="crm-primary" disabled={busy} aria-busy={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
            {connection?.provider_app_id && <small className="crm-success">On: messages are marked read when the AI replies.</small>}
          </div>
        </form>
        {message && <p role="status" className="crm-success">{message}</p>}
        {error && <p role="alert" className="crm-error">{error}</p>}
      </div>
    );

  return (
    <form
      className="crm-provider crm-provider-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const result = await post({
          action: "gupshup",
          app: form.get("app"),
          phone: form.get("phone"),
          apiKey: form.get("apiKey"),
        });
        if (result) await onChanged();
      }}
    >
      <p>
        <strong>Connect your Gupshup app</strong>
        <small>
          Messages go out from your own number, under your name. In Gupshup, create a
          WhatsApp app, connect your number, then copy the app name and API key here.
        </small>
      </p>
      <details className="crm-setup-guide">
        <summary>New to Gupshup? Step-by-step setup (about 20 minutes)</summary>
        <ol>
          <li>
            <strong>Create a free account</strong> at gupshup.io with your business email.
          </li>
          <li>
            <strong>Create a WhatsApp app.</strong> Pick a short name with letters and numbers
            only (e.g. SunriseRealty). This is the <em>app name</em> you&apos;ll enter below.
          </li>
          <li>
            <strong>Connect your number.</strong> In the app, start the WhatsApp onboarding and
            sign in with Facebook. Choose or create your Meta business, then add the number your
            clients know. It can&apos;t be active on the WhatsApp app at the same time, so delete
            the WhatsApp account on that phone first (or use a new number). Verify it with the
            code Meta sends and set your display name.
          </li>
          <li>
            <strong>Add wallet balance</strong> in Gupshup. Meta&apos;s per-message charges for
            follow-up templates are paid from it.
          </li>
          <li>
            <strong>Copy the API key</strong> from the app&apos;s settings. Gupshup shows it only
            once, so paste it straight into the form below.
          </li>
          <li>
            <strong>Connect here,</strong> then paste the callback URL we show you into Gupshup
            → Webhooks so incoming messages reach your inbox.
          </li>
          <li>
            <strong>Turn on follow-ups</strong> in WhatsApp follow-ups above: create the template
            in Gupshup, add it once approved, use Send test, then switch it on.
          </li>
        </ol>
        <p>Stuck on a step? Email support and we&apos;ll set it up with you.</p>
      </details>
      <label>
        Gupshup app name
        <input name="app" required maxLength={100} autoComplete="off" placeholder="VeyrnRealty" />
      </label>
      <label>
        WhatsApp number (with country code)
        <input name="phone" required inputMode="tel" autoComplete="off" placeholder="919876543210" />
      </label>
      <label>
        API key
        <input name="apiKey" type="password" required autoComplete="off" />
      </label>
      <button className="crm-primary" disabled={busy} aria-busy={busy}>
        {busy ? "Connecting…" : "Connect with Gupshup"}
      </button>
      {error && <p role="alert" className="crm-error">{error}</p>}
    </form>
  );
}
