"use client";

import { useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { site } from "@/lib/site";
import { CRM_PLANS, planPrice } from "@/lib/crm/plans";
import styles from "./pricing.module.css";

const periods = [
  { name: "Monthly", months: 1, discount: 0, interval: "month" },
  { name: "Quarterly", months: 3, discount: 10, interval: "quarter" },
  { name: "Annually", months: 12, discount: 20, interval: "year" },
] as const;
const plans = [
  {
    id: "pro",
    name: "Pro",
    price: CRM_PLANS.pro.monthlyPaise / 100,
    description: "Bring your leads, conversations, and follow-ups together.",
    features: [
      "1 included user: your company admin",
      "Lead records and sales pipeline",
      "Standard lead-source integrations",
      "AI chatbot for initial replies and qualification",
      "Manually scheduled follow-ups and reminders",
      "Manual lead assignment and human handover",
      "Manual site-visit scheduling",
      "Defined AI and messaging allowances; no unlimited usage",
      "Lead and pipeline overview",
      "Standard onboarding and support",
    ],
  },
  {
    id: "pro_plus",
    name: "Pro Plus",
    price: CRM_PLANS.pro_plus.monthlyPaise / 100,
    description: "Coordinate your agents with more advanced automation.",
    features: [
      "Everything in Pro",
      "3 included users: admin plus 2 teammates",
      "Advanced AI qualification workflows",
      "Multi-step, reply-based follow-ups",
      "Automatic lead routing to agents",
      "Automatic scheduling and site-visit follow-ups",
      "Lead-source performance reporting",
      "Agent activity reporting",
      "Standard onboarding and priority support",
    ],
  },
] as const;
const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

export function Pricing() {
  const [selected, setSelected] = useState(0);
  const period = periods[selected];
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
          ? "Pay monthly. Standard onboarding included."
          : `Pay for ${period.months} months upfront and save ${period.discount}% compared with monthly billing.`}
      </p>
      <div className={styles.cards}>
        {plans.map((plan, index) => {
          const quote = planPrice(plan.id, period.months);
          const monthly = quote.monthlyPaise / 100;
          const total = quote.totalPaise / 100;
          const savings = plan.price * period.months - total;
          const subject = `${plan.name} CRM: ${period.name} subscription`;
          const body = `Hi Veyrn Labs,\n\nI’m interested in ${plan.name}, billed ${rupees(total)} per ${period.interval}, before applicable taxes.\n\nBusiness name:\nTeam size:\nLead sources:\nPlease share the onboarding steps and confirm included usage and any additional charges.\n`;
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
                <span>/month</span>
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
              <ButtonLink
                href={`mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
                variant={index ? "primary" : "outline"}
                aria-label={`Get started with ${plan.name}, ${period.name.toLowerCase()}`}
              >
                Get started with {plan.name} <span aria-hidden="true">↗</span>
              </ButtonLink>
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
        These plans describe our product offering; AI automation and
        integrations are being prepared for onboarding. We confirm available
        capabilities before payment. Prices in INR, before applicable taxes.
        Additional users cost ₹500 each; the billing terms are confirmed before purchase.
        AI and messaging usage are limited. Allowances, storage, and any additional messaging
        or integration charges are confirmed before subscription. No automatic overage charges. Contact us to
        arrange onboarding; selecting a plan does not take payment.
      </p>
    </>
  );
}
