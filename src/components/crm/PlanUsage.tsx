"use client";
import { useState } from "react";
import { CRM_PLANS, type UsageSummary } from "@/lib/crm/plans";
import { Billing } from "./Billing";
import { BillingManage } from "./BillingManage";

const stuckBillingMessage: Record<string, string> = {
  created: "Checkout was started but not completed. Resume it below.",
  authenticated: "Payment method saved; waiting for the first charge to confirm your plan.",
  pending: "A recent charge failed and is being retried by Razorpay.",
  halted: "Billing was paused after repeated failed charges. Contact us to resolve this.",
};

export function PlanUsage({ demo, role }: { demo: boolean; role: string }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (role === "team") return null;
  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/crm/usage", { cache: "no-store" });
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
        <button disabled={busy || demo} onClick={() => void load()}>
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
        {(summary?.status === "unconfigured" || summary?.status === "inactive") && (
          <>
            <p>
              No paid allowance is currently active. AI and WhatsApp
              automation remain unavailable until your plan and allowances are
              configured.
            </p>
            {!summary.billing_status ||
            ["cancelled", "completed", "expired"].includes(summary.billing_status) ? (
              role === "owner" ? (
                <Billing onStarted={() => void load()} />
              ) : (
                <p>Ask the workspace owner to activate a plan.</p>
              )
            ) : (
              <p role="status">
                {stuckBillingMessage[summary.billing_status] ??
                  `Checkout status: ${summary.billing_status}.`}
              </p>
            )}
          </>
        )}
        {summary?.plan && (
          <>
            <h3>{CRM_PLANS[summary.plan].name}</h3>
            <p>
              {summary.member_count} users · {summary.included_seats} included +{" "}
              {summary.purchased_seats} additional seats
            </p>
            <p>
              Scheduling entitlement:{" "}
              {summary.automatic_scheduling ? "Automatic" : "Manual"}.
            </p>
          </>
        )}
        {summary?.status === "inactive" && (
          <p>
            No active usage period. Contact support to renew or activate your
            subscription.
          </p>
        )}
        {summary?.status === "active" && (
          <>
            <p>
              Current allowance ends{" "}
              {new Date(summary.period_end!).toLocaleDateString("en-IN")}.
            </p>
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
            <p>
              Pending requests count toward usage. Reaching an allowance pauses
              the affected automation. Additional usage requires a separately
              approved purchase; there are no automatic overage charges.
            </p>
          </>
        )}
        {summary && !demo && role === "owner" && <BillingManage summary={summary} reload={() => void load()} />}
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
