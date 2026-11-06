"use client";
import { crmFetch } from "./activity";
import { useState } from "react";
import { CRM_PLANS, type UsageSummary } from "@/lib/crm/plans";
import { Billing } from "./Billing";
import { BillingManage } from "./BillingManage";

const stuckBillingMessage: Record<string, string> = {
  created: "Checkout was started but not paid. Resume it to activate your plan, or cancel it to choose a different plan.",
  authenticated: "Payment method saved; waiting for the first charge to confirm your plan.",
  pending: "A recent charge failed and is being retried by Razorpay.",
  halted: "Billing was paused after repeated failed charges. Contact us to resolve this.",
};

const periodName: Record<number, string> = { 1: "Monthly", 3: "Quarterly", 12: "Annual" };
const billingBadge: Record<string, string> = {
  created: "Awaiting payment",
  authenticated: "Awaiting first charge",
  pending: "Payment retrying",
  halted: "Payment failed",
};
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Base plan and seats are separate Razorpay subscriptions; this shows what each charges.
function BillSummary({ summary }: { summary: UsageSummary }) {
  const base = summary.billing;
  const seats = (summary.seat_subscriptions ?? []).filter(
    (seat) => seat.status !== "created" && seat.unit_paise,
  );
  if (!base && !seats.length) return null;
  const seatTotal = seats.reduce((sum, seat) => sum + seat.quantity * seat.unit_paise!, 0);
  const monthlyTotal =
    base?.billing_months === 1 ? base.amount_paise + seatTotal : null;
  return (
    <div className="crm-bill">
    <dl>
      {base && (
        <div>
          <dt>
            {CRM_PLANS[base.plan].name} · {periodName[base.billing_months]}
          </dt>
          <dd>
            {rupees(base.amount_paise)}
            {base.billing_months === 1 ? "/month" : ` every ${base.billing_months} months`}
          </dd>
        </div>
      )}
      {seats.map((seat) => (
        <div key={seat.id}>
          <dt>
            {seat.quantity} additional {seat.quantity === 1 ? "user" : "users"} ×{" "}
            {rupees(seat.unit_paise!)}
          </dt>
          <dd>{rupees(seat.quantity * seat.unit_paise!)}/month</dd>
        </div>
      ))}
      {monthlyTotal !== null && seats.length > 0 && (
        <div className="crm-bill-total">
          <dt>Total each month</dt>
          <dd>{rupees(monthlyTotal)}</dd>
        </div>
      )}
    </dl>
      <p className="crm-muted">GST extra. Additional users are billed monthly, separately from the plan.</p>
    </div>
  );
}

export function PlanUsage({ demo, role }: { demo: boolean; role: string }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending =
    !!summary?.billing &&
    ["created", "authenticated", "pending", "halted"].includes(summary.billing.status);
  if (role === "team") return null;
  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await crmFetch("/api/crm/usage", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load usage.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="crm-panel crm-plan-usage">
      <div className="crm-panel-heading">
        <div>
          <h2>Plan & usage</h2>
          <p>AI and WhatsApp allowances are shared across your company.</p>
        </div>
        <button aria-busy={busy} disabled={busy || demo} onClick={() => void load()}>
          {busy ? "Loading…" : summary ? "Refresh" : "View usage"}
        </button>
      </div>
      <div className="crm-settings-body" aria-live="polite">
        {demo && <p>Plan usage is available in your live workspace.</p>}
        {error && <p role="alert">{error}</p>}
        {summary?.trial && (
          <p>
            Testing allowance · {summary.ai_limit} AI drafts and{" "}
            {summary.whatsapp_limit} manually approved WhatsApp replies. No paid
            subscription is active.
          </p>
        )}
        {!demo && !summary && !error && (
          <p>View your subscription, included users and available usage.</p>
        )}
        {summary?.status === "active" && summary.plan && (
          <div className="crm-plan-current">
            <div className="crm-plan-current-head">
              <div>
                <span className="crm-eyebrow">Current plan</span>
                <h3>{CRM_PLANS[summary.plan].name}</h3>
              </div>
              <span className="crm-badge won">Active</span>
            </div>
            <dl className="crm-plan-facts">
              <div>
                <dt>Users</dt>
                <dd>
                  {summary.member_count} of{" "}
                  {(summary.included_seats ?? 0) + (summary.purchased_seats ?? 0)} seats in use
                </dd>
              </div>
              <div>
                <dt>Seats</dt>
                <dd>
                  {summary.included_seats} included
                  {summary.purchased_seats ? ` + ${summary.purchased_seats} additional` : ""}
                </dd>
              </div>
              <div>
                <dt>Site-visit booking</dt>
                <dd>{summary.automatic_scheduling ? "Automatic" : "Manual"}</dd>
              </div>
              {summary.period_end && (
                <div>
                  <dt>Allowance resets</dt>
                  <dd>{formatDate(summary.period_end)}</dd>
                </div>
              )}
            </dl>
            <BillSummary summary={summary} />
          </div>
        )}
        {summary && summary.status !== "active" && pending && summary.billing && (
          <div className="crm-plan-current">
            <div className="crm-plan-current-head">
              <div>
                <span className="crm-eyebrow">Checkout pending</span>
                <h3>
                  {CRM_PLANS[summary.billing.plan].name} ·{" "}
                  {periodName[summary.billing.billing_months]}
                </h3>
              </div>
              <span className="crm-badge">{billingBadge[summary.billing.status]}</span>
            </div>
            <p className="crm-plan-pending-price">
              <strong>{rupees(summary.billing.amount_paise)}</strong>{" "}
              {summary.billing.billing_months === 1
                ? "/month + GST"
                : `every ${summary.billing.billing_months} months + GST`}
            </p>
            <p className="crm-muted">{stuckBillingMessage[summary.billing.status]}</p>
            {role === "owner" && (
              <BillingManage summary={summary} reload={() => void load()} part="actions" />
            )}
          </div>
        )}
        {(summary?.status === "unconfigured" || summary?.status === "inactive") && (
          <>
            <p className="crm-plan-notice">
              No paid plan is active right now. AI and WhatsApp automation turn
              on once {pending ? "checkout is complete" : "you subscribe"}.
            </p>
            {!pending &&
              (role === "owner" ? (
                <Billing onStarted={() => void load()} />
              ) : (
                <p>Ask the workspace owner to activate a plan.</p>
              ))}
          </>
        )}
        {summary?.status === "active" && (
          <>
            <UsageMeter
              label="AI replies"
              used={summary.ai_used!}
              limit={summary.ai_limit!}
            />
            <UsageMeter
              label="WhatsApp messages"
              used={summary.whatsapp_used!}
              limit={summary.whatsapp_limit!}
            />
            {summary.automation_paused && (
              <p role="status">
                Automation is paused. Contact support to review your service
                allowance.
              </p>
            )}
            <p className="crm-muted">
              Pending requests count toward usage. Reaching an allowance pauses
              the affected automation. There are no automatic overage charges.
            </p>
          </>
        )}
        {summary && !demo && role === "owner" && (
          <BillingManage summary={summary} reload={() => void load()} part={summary.status === "active" ? "all" : "seats"} />
        )}
        {summary?.trial && role === "owner" && <Billing onStarted={() => void load()} />}
      </div>
    </section>
  );
}

function UsageMeter({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const ratio = used / limit;
  return (
    <div className="crm-usage-meter">
      <div>
        <strong>{label}</strong>
        <span>
          {used.toLocaleString("en-IN")} / {limit.toLocaleString("en-IN")}
        </span>
      </div>
      <progress aria-label={label} value={Math.min(used, limit)} max={limit} />
      {ratio >= 0.8 && (
        <p>
          {ratio >= 1
            ? "Allowance reached. Additional requests are paused."
            : "You have used at least 80% of this allowance."}
        </p>
      )}
    </div>
  );
}
