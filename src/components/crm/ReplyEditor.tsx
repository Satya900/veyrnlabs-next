"use client";
import { useEffect, useState } from "react";
import { deliveryLabel, type Delivery } from "@/lib/crm/delivery";
const labels: Record<string, string> = {
  dispatching: "Send pending. Do not resend; support can check this attempt.",
  accepted: "Accepted by WhatsApp. Delivery has not yet been confirmed.",
  rejected:
    "WhatsApp rejected this attempt. Ask support to check the connection before retrying.",
  unknown:
    "Send outcome is uncertain. Do not resend; support must reconcile this attempt.",
};
export function ReplyEditor({
  draft,
  initialText,
}: {
  draft: string;
  initialText: string;
}) {
  const [text, setText] = useState(initialText);
  const [approved, setApproved] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState("");
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/crm/whatsapp/send?draft=${draft}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (controller.signal.aborted) return;
        setConfigured(data.configured);
        setStatus(data.attempt?.status ?? "");
        setDelivery(data.attempt ?? null);
        if (data.attempt) setText(data.attempt.body);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [draft, version]);
  return (
    <form
      className="crm-ai-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!approved || busy || status) return;
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/crm/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draft, text, approved }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          setStatus(result.status);
          setApproved(false);
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Unable to confirm sending.",
          );
        } finally {
          setBusy(false);
          setVersion((v) => v + 1);
        }
      }}
    >
      <label>
        Review and edit your reply
        <textarea
          value={text}
          maxLength={3000}
          rows={6}
          disabled={busy || Boolean(status)}
          onChange={(e) => {
            setText(e.target.value);
            setApproved(false);
          }}
        />
      </label>
      <small>
        {text.length} / 3,000 characters.{" "}
        {status === "accepted"
          ? "This reply was sent to the customer."
          : status
            ? "This is the saved text for this send attempt."
            : "This text will be sent to the customer in this conversation."}
      </small>
      {!configured && (
        <p>
          Sending is not enabled. A messaging allowance and connection setup are
          required to send.
        </p>
      )}
      {!status && (
        <>
          <label className="crm-ai-check">
            <input
              type="checkbox"
              checked={approved}
              disabled={busy || !configured}
              onChange={(e) => setApproved(e.target.checked)}
            />{" "}
            I reviewed this reply and approve sending it to this customer.
          </label>
          <button
            className="crm-primary"
            disabled={busy || !configured || !approved || !text.trim()}
          >
            {busy ? "Sending…" : "Send WhatsApp reply"}
          </button>
        </>
      )}
      {status && (
        <p role="status">
          {delivery
            ? deliveryLabel(delivery)
            : (labels[status] ?? "Check this send attempt with support.")}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
