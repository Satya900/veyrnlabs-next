"use client";
import { useState } from "react";
import {
  CRM_PLANS,
  BILLING_DISCOUNTS,
  planPrice,
  type PlanId,
  type BillingMonths,
} from "@/lib/crm/plans";

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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function subscribe(plan: PlanId, months: BillingMonths) {
    const key = `${plan}:${months}`;
    setBusy(key);
    setError("");
    try {
      const res = await fetch("/api/crm/billing", {
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
  return (
    <div className="crm-settings-body">
      <p>Choose a plan to activate billing for this business.</p>
      {periods.map((period) => (
        <div key={period.months} className="crm-billing-period">
          <h4>
            {period.label}
            {BILLING_DISCOUNTS[period.months] > 0 &&
              ` · Save ${BILLING_DISCOUNTS[period.months]}%`}
          </h4>
          <div className="crm-billing-plans">
            {(Object.keys(CRM_PLANS) as PlanId[]).map((plan) => {
              const price = planPrice(plan, period.months);
              const key = `${plan}:${period.months}`;
              return (
                <div key={key} className="crm-billing-plan">
                  <strong>{CRM_PLANS[plan].name}</strong>
                  <span>
                    {rupees(price.monthlyPaise)}/month, billed{" "}
                    {rupees(price.totalPaise)} {period.label.toLowerCase()}
                  </span>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void subscribe(plan, period.months)}
                  >
                    {busy === key
                      ? "Opening checkout…"
                      : `Subscribe to ${CRM_PLANS[plan].name}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
    </div>
  );
}
