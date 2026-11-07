"use client";

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import {
  CRM_PLANS,
  EXTRA_SEAT_PAISE,
  planPrice,
  type PlanId,
} from "@/lib/crm/plans";
import styles from "./pricing.module.css";

type PlanStatus = {
  signedIn: boolean;
  canManageBilling?: boolean;
  status?: "unconfigured" | "inactive" | "active";
  plan?: PlanId | null;
  billingMonths?: 1 | 3 | 12 | null;
};

const periods = [
  { name: "Monthly", months: 1, discount: 0, interval: "month" },
  { name: "Quarterly", months: 3, discount: 10, interval: "quarter" },
  { name: "Annually", months: 12, discount: 20, interval: "year" },
] as const;
const count = (n: number) => n.toLocaleString("en-IN");
const plans = [
  {
    id: "pro" as const,
    name: "Pro",
    price: CRM_PLANS.pro.monthlyPaise / 100,
    description: "Your AI co-pilot: it reads every chat and suggests the reply; you send it.",
    features: [
      "1 included user: your company admin",
      `${count(CRM_PLANS.pro.aiActions)} AI actions a month, ${count(CRM_PLANS.pro.firstMonthAiActions)} in your first month`,
      "AI reads every WhatsApp chat: one-tap reply suggestions, lead details and Hot / Warm / Cold scores",
      "WhatsApp inbox with automatic follow-ups from your own number",
      "AI-drafted follow-up emails for leads that go quiet",
      "Lead records, sales pipeline and CSV import",
      "Manual site-visit scheduling",
      "Try AI auto-replies free for 14 days",
      "Self-serve setup with email support",
    ],
  },
  {
    id: "pro_plus" as const,
    name: "Pro Plus",
    price: CRM_PLANS.pro_plus.monthlyPaise / 100,
    description: "Your AI autopilot: it replies to customers 24/7 and books visits while you work.",
    features: [
      "Everything in Pro",
      "3 included users: admin plus 2 teammates",
      `${count(CRM_PLANS.pro_plus.aiActions)} AI actions a month shared by the team, ${count(CRM_PLANS.pro_plus.firstMonthAiActions)} in your first month`,
      "AI replies to every WhatsApp enquiry within seconds, 24/7, in the customer's language",
      "AI books eligible site visits straight from WhatsApp, no back-and-forth",
      "Lead-source performance reporting to see what's converting",
      "Self-serve setup with priority email support",
    ],
  },
];
const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

export function Pricing() {
  const [selected, setSelected] = useState(0);
  const [planStatus, setPlanStatus] = useState<PlanStatus | null>(null);
  const period = periods[selected];

  useEffect(() => {
    let cancelled = false;
    fetch("/api/crm/plan-status", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setPlanStatus(data);
      })
      .catch(() => {
        if (!cancelled) setPlanStatus({ signedIn: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function callToAction(planId: PlanId) {
    if (!planStatus || !planStatus.signedIn)
      return { label: `Get started with ${CRM_PLANS[planId].name}`, href: "/crm?view=settings" };
    if (planStatus.canManageBilling === false)
      return { label: "Ask your workspace owner", href: null };
    const isCurrent =
      planStatus.status === "active" &&
      planStatus.plan === planId &&
      planStatus.billingMonths === period.months;
    if (isCurrent) return { label: "Your current plan", href: null };
    const label =
      planStatus.status === "active"
        ? `Upgrade to ${CRM_PLANS[planId].name}`
        : `Subscribe to ${CRM_PLANS[planId].name}`;
    return { label, href: "/crm?view=settings" };
  }

  return (
    <>
      <div
        className={styles.billing}
        role="group"
        aria-label="Billing duration"
      >
        {periods.map((item, index) => (
          <button
            key={item.name}
            type="button"
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            {item.name}
            {item.discount > 0 && <span>Save {item.discount}%</span>}
          </button>
        ))}
      </div>
      <p className={styles.billingNote} aria-live="polite">
        {period.months === 1
          ? "Pay monthly. Cancel renewal any time."
          : `Pay for ${period.months} months upfront and save ${period.discount}% compared with monthly billing.`}
      </p>
      <div className={styles.cards}>
        <article className={styles.card}>
          <p className={styles.kicker}>ALWAYS FREE</p>
          <h3>Free</h3>
          <p className={styles.description}>
            Organise your leads and clients. No AI, no messaging, no
            scheduling.
          </p>
          <div className={styles.price}>
            <strong>₹0</strong>
            <span>/month</span>
          </div>
          <p className={styles.total}>No card required</p>
          <p className={styles.savings}>Upgrade any time</p>
          <ButtonLink
            href={planStatus?.signedIn ? "/crm" : "/crm/signup"}
            variant="outline"
          >
            {planStatus?.signedIn ? "Go to your workspace" : "Get started free"}{" "}
            <span aria-hidden="true">↗</span>
          </ButtonLink>
          <ul>
            {[
              "1 included user",
              "Lead records and sales pipeline",
              "Client relationship tracking",
              "Manual follow-up reminders",
            ].map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
            {[
              "No AI assistant",
              "No WhatsApp or email automation",
              "No site-visit scheduling",
            ].map((limit) => (
              <li key={limit} className={styles.limit}>
                {limit}
              </li>
            ))}
          </ul>
        </article>
        {plans.map((plan, index) => {
          const quote = planPrice(plan.id, period.months);
          const monthly = quote.monthlyPaise / 100;
          const total = quote.totalPaise / 100;
          const savings = plan.price * period.months - total;
          const cta = callToAction(plan.id);
          return (
            <article
              key={plan.name}
              className={`${styles.card} ${index ? styles.plus : ""}`}
            >
              <p className={styles.kicker}>
                {index
                  ? "MORE AUTOMATION. MORE VISIBILITY."
                  : "YOUR DAILY SALES WORKSPACE"}
              </p>
              <h3>{plan.name}</h3>
              <p className={styles.description}>{plan.description}</p>
              <div className={styles.price}>
                <strong>{rupees(monthly)}</strong>
                <span>/month + GST</span>
              </div>
              <p className={styles.total}>
                {rupees(total)} billed {period.name.toLowerCase()}
                {period.months > 1 ? " upfront" : ""}
              </p>
              <p className={styles.savings}>
                {savings
                  ? `Save ${rupees(savings)} per ${period.interval}`
                  : "No quarterly or annual prepayment"}
              </p>
              {cta.href ? (
                <ButtonLink
                  href={cta.href}
                  variant={index ? "primary" : "outline"}
                  aria-label={`${cta.label}, ${period.name.toLowerCase()}`}
                >
                  {cta.label} <span aria-hidden="true">↗</span>
                </ButtonLink>
              ) : (
                <span className={styles.currentPlan} aria-live="polite">
                  {cta.label}
                </span>
              )}
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      <p className={styles.terms}>
        Prices in INR, exclusive of 18% GST. Additional users cost{" "}
        {rupees(EXTRA_SEAT_PAISE / 100)} each per month. AI actions and messaging are limited by plan; allowances reset
        each month and never trigger automatic overage charges.
        Subscribing opens secure checkout with Razorpay and starts billing
        immediately.
      </p>
    </>
  );
}
