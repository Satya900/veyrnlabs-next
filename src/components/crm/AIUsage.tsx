"use client";
import { useCallback, useEffect, useState } from "react";
import { crmFetch } from "./activity";
import { loadRazorpayScript } from "./Billing";
import { AI_TOPUP } from "@/lib/crm/plans";

export type AIUsageData = {
  period: { starts_at: string; ends_at: string; trial: boolean } | null;
  ai?: { used: number; limit: number; topup?: number };
  whatsapp?: { used: number; limit: number };
  breakdown?: { insights: number; auto_replies: number; drafts: number; emails: number };
};

/** Fire after anything that spends an AI action so every meter on the page updates. */
export const AI_USAGE_EVENT = "crm:ai-usage";
export function aiUsageChanged() {
  window.dispatchEvent(new Event(AI_USAGE_EVENT));
}

const count = (n: number) => n.toLocaleString("en-IN");
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/**
 * Live usage: loads on mount, then refreshes every minute (automatic replies spend actions
 * in the background), when the tab regains focus, and right after an AI action here.
 */
function useAIUsage(demo: boolean) {
  const [usage, setUsage] = useState<AIUsageData | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await crmFetch("/api/crm/usage/ai", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setUsage(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    if (demo) return;
    // First load is deferred a tick so it isn't a synchronous state update in the effect.
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 60_000);
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    window.addEventListener(AI_USAGE_EVENT, refresh);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(AI_USAGE_EVENT, refresh);
    };
  }, [demo, load]);
  return { usage, failed, reload: load };
}

function level(used: number, limit: number) {
  const ratio = limit > 0 ? used / limit : 1;
  return ratio >= 1 ? "full" : ratio >= 0.8 ? "high" : "ok";
}

function Bar({ used, limit, label }: { used: number; limit: number; label: string }) {
  return (
    <div className={`crm-ai-bar ${level(used, limit)}`}>
      <progress aria-label={label} value={Math.min(used, limit)} max={Math.max(limit, 1)} />
    </div>
  );
}

/** Compact meter at the bottom of the sidebar; opens Settings for the details. */
export function AIUsageCard({ demo, role, onOpen }: { demo: boolean; role: string; onOpen: () => void }) {
  const { usage } = useAIUsage(demo);
  if (demo || !usage) return null;
  if (!usage.period || !usage.ai)
    return (
      <button type="button" className="crm-ai-usage-card" onClick={onOpen}>
        <span className="crm-ai-usage-top">
          <strong>AI actions</strong>
          <span>No active plan</span>
        </span>
        <small>Choose a plan in Settings to use AI.</small>
      </button>
    );
  const { used, limit } = usage.ai;
  const left = Math.max(limit - used, 0);
  return (
    <button
      type="button"
      className="crm-ai-usage-card"
      onClick={onOpen}
      title={`${count(used)} of ${count(limit)} AI actions used this month. Resets ${day(usage.period.ends_at)}.`}
    >
      <span className="crm-ai-usage-top">
        <strong>AI actions</strong>
        <span>
          {count(used)} / {count(limit)}
        </span>
      </span>
      <Bar used={used} limit={limit} label="AI actions used this month" />
      <small>
        {left === 0 ? "Allowance used up" : `${count(left)} left`} · resets {day(usage.period.ends_at)}
      </small>
      {role === "owner" && !usage.period.trial && level(used, limit) !== "ok" && (
        <span className="crm-ai-usage-cta">
          + {count(AI_TOPUP.actions)} more for ₹{AI_TOPUP.paise / 100}
        </span>
      )}
    </button>
  );
}

/** Full breakdown at the top of Settings. */
export function AIUsagePanel({ demo, role }: { demo: boolean; role: string }) {
  const { usage, failed, reload } = useAIUsage(demo);
  const rows: [string, string, number][] = usage?.breakdown
    ? [
        ["Chat insights and reply suggestions", "Summary, Hot / Warm / Cold and lead details when a chat has new messages", usage.breakdown.insights],
        ["Automatic replies", "Replies the AI wrote by itself, including ones it handed to your team instead of sending", usage.breakdown.auto_replies],
        ["Reply drafts", "Drafts generated from the AI reply assistant", usage.breakdown.drafts],
        ["Follow-up emails", "AI-written emails for leads that went quiet", usage.breakdown.emails],
      ]
    : [];
  return (
    <section className="crm-panel">
      <div className="crm-panel-heading">
        <div>
          <h2>AI usage</h2>
          <p>
            Shared by everyone in this workspace. One AI action is one insight refresh, automatic
            reply, reply draft or follow-up email. Chats with AI off use none.
          </p>
        </div>
        {!demo && (
          <button type="button" onClick={() => void reload()}>
            Refresh
          </button>
        )}
      </div>
      <div className="crm-settings-body crm-ai-usage-panel">
        {demo && <p className="crm-muted">Usage appears in your live workspace.</p>}
        {!demo && failed && !usage && <p className="crm-error">Usage couldn&apos;t be loaded. Try Refresh.</p>}
        {!demo && usage && !usage.period && (
          <p className="crm-muted">No active plan. AI actions are included with Pro and Pro Plus.</p>
        )}
        {usage?.period && usage.ai && usage.whatsapp && (
          <>
            <div className="crm-ai-usage-meters">
              <div>
                <div className="crm-ai-usage-top">
                  <strong>AI actions</strong>
                  <span>
                    {count(usage.ai.used)} / {count(usage.ai.limit)}
                  </span>
                </div>
                <Bar used={usage.ai.used} limit={usage.ai.limit} label="AI actions used this month" />
                <small>
                  {level(usage.ai.used, usage.ai.limit) === "full"
                    ? "Allowance used up. AI features pause until it resets."
                    : `${count(Math.max(usage.ai.limit - usage.ai.used, 0))} left`}{" "}
                  · {day(usage.period.starts_at)} to {day(usage.period.ends_at)}
                </small>
              </div>
              <div>
                <div className="crm-ai-usage-top">
                  <strong>Automated WhatsApp messages</strong>
                  <span>
                    {count(usage.whatsapp.used)} / {count(usage.whatsapp.limit)}
                  </span>
                </div>
                <Bar used={usage.whatsapp.used} limit={usage.whatsapp.limit} label="WhatsApp messages used this month" />
                <small>Follow-ups, automatic replies and replies sent from the inbox.</small>
              </div>
            </div>
            {role === "owner" && !usage.period.trial && (
              <TopUp ai={usage.ai} endsAt={usage.period.ends_at} onDone={() => void reload()} />
            )}
            <ul className="crm-ai-usage-breakdown">
              {rows.map(([label, hint, n]) => (
                <li key={label}>
                  <span>
                    <strong>{label}</strong>
                    <small>{hint}</small>
                  </span>
                  <b>{count(n)}</b>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/** Buy one AI top-up pack with a one-time Razorpay payment; credited to this month. */
function TopUp({
  ai,
  endsAt,
  onDone,
}: {
  ai: { used: number; limit: number; topup?: number };
  endsAt: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function post(body: Record<string, unknown>) {
    const res = await crmFetch("/api/crm/billing/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    return result;
  }
  async function buy() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const order = await post({ action: "create" });
      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error("Payment form unavailable.");
      new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: "INR",
        name: "Veyrn CRM",
        description: `${count(order.actions)} AI actions`,
        handler: async (paid: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            const result = await post({
              action: "verify",
              orderId: paid.razorpay_order_id,
              paymentId: paid.razorpay_payment_id,
              signature: paid.razorpay_signature,
            });
            setMessage(`${count(result.actions)} AI actions added. They're yours until ${day(endsAt)}.`);
            aiUsageChanged();
            onDone();
          } catch (err) {
            setError(err instanceof Error ? err.message : "The payment couldn't be confirmed.");
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Top-up failed.");
      setBusy(false);
    }
  }
  return (
    <div className="crm-ai-topup">
      <div>
        <strong>Need more AI this month?</strong>
        <small>
          Add {count(AI_TOPUP.actions)} AI actions for ₹{AI_TOPUP.paise / 100}, a one-time payment. They
          last until your allowance resets on {day(endsAt)}.
          {ai.topup ? ` Top-ups this month: +${count(ai.topup)}.` : ""}
        </small>
      </div>
      <button type="button" className="crm-primary" disabled={busy} aria-busy={busy} onClick={() => void buy()}>
        {busy ? "Opening payment…" : `Buy ${count(AI_TOPUP.actions)} for ₹${AI_TOPUP.paise / 100}`}
      </button>
      {message && <p role="status" className="crm-success">{message}</p>}
      {error && <p role="alert" className="crm-error">{error}</p>}
    </div>
  );
}
