"use client";
import { useState } from "react";
import { crmFetch } from "./activity";

type Connection = {
  active: boolean;
  display_phone: string;
  provider?: "meta" | "gupshup";
  provider_app?: string | null;
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
