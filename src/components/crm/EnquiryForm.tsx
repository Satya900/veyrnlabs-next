"use client";
import { useState } from "react";

/** The public enquiry form behind a workspace's capture link. */
export function EnquiryForm({ token, business, source, embedded }: {
  token: string;
  business: string;
  source: string;
  embedded: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <main className={embedded ? "crm-enquiry is-embedded" : "crm-enquiry"}>
      <div className="crm-enquiry-card">
        {!embedded && (
          <header>
            <span className="crm-eyebrow">Enquiry</span>
            <h1>{business}</h1>
            <p>Tell us what you&apos;re looking for. We usually reply on WhatsApp within minutes.</p>
          </header>
        )}
        {sent ? (
          <div role="status" className="crm-enquiry-done">
            <strong>Thank you!</strong>
            <p>We&apos;ve received your enquiry and will contact you shortly on WhatsApp or phone.</p>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = Object.fromEntries(new FormData(e.currentTarget));
              setBusy(true);
              setError("");
              try {
                const res = await fetch(`/api/leads/${token}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ...form, source }),
                });
                const result = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(result.error ?? "Your enquiry couldn't be sent. Try again.");
                setSent(true);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Your enquiry couldn't be sent. Try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Your name
              <input name="name" required maxLength={200} autoComplete="name" />
            </label>
            <label>
              WhatsApp number
              <input name="phone" type="tel" required maxLength={20} inputMode="tel" autoComplete="tel" placeholder="98765 43210" pattern="[0-9+ ()-]{10,20}" />
            </label>
            <label>
              Email <small>(optional)</small>
              <input name="email" type="email" maxLength={200} autoComplete="email" />
            </label>
            <label>
              Looking for
              <input name="looking_for" maxLength={200} placeholder="e.g. 3BHK in Sarjapur" />
            </label>
            <label>
              Budget <small>(optional)</small>
              <input name="budget" maxLength={60} placeholder="e.g. 80 lakh" />
            </label>
            <label>
              Message <small>(optional)</small>
              <textarea name="message" rows={3} maxLength={1000} />
            </label>
            {/* Honeypot: hidden from people, filled by bots. */}
            <input name="website" tabIndex={-1} autoComplete="off" className="crm-enquiry-trap" aria-hidden="true" />
            {error && <p role="alert" className="crm-error">{error}</p>}
            <button type="submit" className="crm-primary" disabled={busy} aria-busy={busy}>
              {busy ? "Sending…" : "Send enquiry"}
            </button>
            <small className="crm-enquiry-consent">
              By sending, you agree that {business} may contact you on WhatsApp and phone about your enquiry.
            </small>
          </form>
        )}
      </div>
      {!embedded && (
        <a className="crm-enquiry-brand" href="https://veyrnlabs.com" target="_blank" rel="noopener">
          Powered by Veyrn CRM
        </a>
      )}
    </main>
  );
}
