"use client";
import { crmFetch } from "./activity";
import { useState } from "react";
import {
  CRM_PLANS,
  BILLING_DISCOUNTS,
  planPrice,
  type PlanId,
  type BillingMonths,
} from "@/lib/crm/plans";
import { PLAN_HIGHLIGHTS } from "./PlanComparison";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const periods: { months: BillingMonths; label: string }[] = [
  { months: 1, label: "Monthly" },
  { months: 3, label: "Quarterly" },
  { months: 12, label: "Annually" },
];
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export function loadRazorpayScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(
        new Error(
          "Could not load the payment form. Check your connection and try again.",
        ),
      );
    document.body.appendChild(script);
  });
}

export function Billing({ onStarted }: { onStarted: () => void }) {
  const [months, setMonths] = useState<BillingMonths>(1);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function subscribe(plan: PlanId, months: BillingMonths) {
    const key = `${plan}:${months}`;
    setBusy(key);
    setError("");
    try {
      const res = await crmFetch("/api/crm/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "subscribe", plan, months }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error("Payment form unavailable.");
      const checkout = new window.Razorpay({
        key: result.keyId,
        subscription_id: result.subscriptionId,
        name: "Veyrn CRM",
        description: `${CRM_PLANS[plan].name} · ${periods.find((p) => p.months === months)?.label}`,
        handler: () => onStarted(),
        modal: { ondismiss: () => setBusy("") },
      });
      checkout.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
      setBusy("");
    }
  }
  const period = periods.find((p) => p.months === months)!;
  return (
    <div className="crm-plan-picker">
      <div className="crm-plan-picker-head">
        <p>Choose a plan to activate billing for this business.</p>
        <div className="crm-period-toggle" role="group" aria-label="Billing period">
          {periods.map((p) => (
            <button
              key={p.months}
              type="button"
              aria-pressed={p.months === months}
              onClick={() => setMonths(p.months)}
            >
              {p.label}
              {BILLING_DISCOUNTS[p.months] > 0 && (
                <span>−{BILLING_DISCOUNTS[p.months]}%</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="crm-plan-options">
        {(Object.keys(CRM_PLANS) as PlanId[]).map((plan) => {
          const price = planPrice(plan, months);
          const key = `${plan}:${months}`;
          const saving = CRM_PLANS[plan].monthlyPaise * months - price.totalPaise;
          return (
            <article
              key={plan}
              className={plan === "pro_plus" ? "crm-plan-option is-plus" : "crm-plan-option"}
            >
              <div className="crm-plan-option-head">
                <h3>{CRM_PLANS[plan].name}</h3>
                {plan === "pro_plus" && <span className="crm-badge">For teams</span>}
              </div>
              <p className="crm-plan-option-price">
                <strong>{rupees(price.monthlyPaise)}</strong>
                <span>/month + GST</span>
              </p>
              <p className="crm-muted">
                {months === 1
                  ? "Billed monthly. Cancel renewal any time."
                  : `Billed ${rupees(price.totalPaise)} ${period.label.toLowerCase()} · save ${rupees(saving)}`}
              </p>
              <ul>
                {PLAN_HIGHLIGHTS[plan].map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <button
                className={plan === "pro_plus" ? "crm-primary" : undefined}
                aria-busy={busy === key}
                type="button"
                disabled={!!busy}
                onClick={() => void subscribe(plan, months)}
              >
                {busy === key ? "Opening checkout…" : `Subscribe to ${CRM_PLANS[plan].name}`}
              </button>
            </article>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
    </div>
  );
}
