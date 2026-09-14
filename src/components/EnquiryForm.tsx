"use client";
import { useRef, useState } from "react";
export function EnquiryForm() {
  const submission = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  if (sent)
    return (
      <div className="enquiry-form" role="status">
        <h3>Thanks for reaching out.</h3>
        <p>
          Your enquiry has been saved. We’ll review your project details and get
          back to you.
        </p>
      </div>
    );
  return (
    <form
      className="enquiry-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        submission.current ??= crypto.randomUUID();
        const values = Object.fromEntries(new FormData(e.currentTarget));
        try {
          const res = await fetch("/api/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...values,
              submission_id: submission.current,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          setSent(true);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Unable to save your enquiry.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Tell us what you have in mind.</h3>
      <div className="enquiry-fields">
        <label>
          Your name
          <input name="name" autoComplete="name" required maxLength={200} />
        </label>
        <label>
          Work email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={200}
          />
        </label>
        <label>
          Company
          <input name="company" autoComplete="organization" maxLength={200} />
        </label>
        <label>
          What do you need?
          <select name="service">
            <option>AI workflow automation</option>
            <option>Custom software</option>
            <option>Website development</option>
            <option>Something else</option>
          </select>
        </label>
      </div>
      <label>
        Project details
        <textarea name="notes" required maxLength={5000} rows={4} />
      </label>
      <div className="enquiry-honeypot" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Saving your enquiry…" : "Send enquiry →"}
      </button>
    </form>
  );
}
