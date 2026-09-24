"use client";
import { useEffect, useState } from "react";
import { ReplyEditor } from "./ReplyEditor";
type Draft = {
  id: string;
  status: string;
  reply: string;
  reason: string;
  created_at: string;
  proposed_visit_at: string | null;
  booking_status: string;
};
function visitLabel(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}
function ProposedVisit({ leadId, draft }: { leadId: string; draft: Draft }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [booked, setBooked] = useState(draft.booking_status === "booked");
  if (!draft.proposed_visit_at) return null;
  if (booked)
    return <p role="status">Site visit booked for {visitLabel(draft.proposed_visit_at)}.</p>;
  return (
    <div className="crm-ai-booking">
      <p>Customer requested a site visit: {visitLabel(draft.proposed_visit_at)}.</p>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const start = new Date(draft.proposed_visit_at!);
            const end = new Date(start.getTime() + 30 * 60_000);
            const response = await fetch("/api/crm/calendar/book", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                leadId,
                startIso: start.toISOString(),
                endIso: end.toISOString(),
              }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            setBooked(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not book this visit.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Booking…" : "Book this visit"}
      </button>
    </div>
  );
}
export function AIDraft({
  conversation,
  leadId,
}: {
  conversation: string;
  leadId: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/crm/ai?conversation=${conversation}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (controller.signal.aborted) return;
        setDraft(result.draft);
        setPaused(result.paused);
        setReady(result.provider_ready);
        setLoaded(true);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : "Unable to load AI tools.",
          );
      });
    return () => controller.abort();
  }, [conversation, version]);
  async function act(action: "generate" | "handover") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/crm/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, conversation, paused: !paused }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.draft) setDraft(result.draft);
      if (action === "handover") setPaused(!paused);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI action failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="crm-settings-body crm-ai-draft">
      <h3>AI reply assistant</h3>
      <p>
        {paused
          ? "Human handover is active. AI generation is paused."
          : "Generate a draft for review. If your admin enabled automatic replies, those run separately."}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="crm-ai-actions">
        <button
          disabled={busy || !loaded || paused || !ready}
          onClick={() => void act("generate")}
        >
          {busy ? "Working…" : "Generate reply draft"}
        </button>
        <button disabled={busy || !loaded} onClick={() => void act("handover")}>
          {paused ? "Allow AI drafts" : "Take over / pause AI"}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setError("");
            setVersion((v) => v + 1);
          }}
        >
          Refresh draft
        </button>
      </div>
      {loaded && !ready && (
        <p>
          Your admin needs to configure the AI provider before drafting is
          available.
        </p>
      )}
      {draft && (
        <div aria-live="polite">
          <strong>
            {
              (
                {
                  generating: "Generation pending",
                  review: "Draft: review required",
                  needs_human: "Human review needed",
                  failed: "Attempt requires reconciliation",
                  superseded: "Draft no longer current",
                } as Record<string, string>
              )[draft.status]
            }
          </strong>
          {draft.reply && <p className="crm-ai-reply">{draft.reply}</p>}
          {draft.reason && <p>{draft.reason}</p>}
          {draft.status === "review" && (
            <ReplyEditor
              key={draft.id}
              draft={draft.id}
              initialText={draft.reply}
            />
          )}
          {draft.status === "needs_human" && (
            <ProposedVisit key={draft.id} leadId={leadId} draft={draft} />
          )}
        </div>
      )}
    </div>
  );
}
