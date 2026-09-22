"use client";

import { useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { site } from "@/lib/site";
import styles from "./pricing.module.css";

const periods = [
  { name: "Monthly", months: 1, discount: 0, interval: "month" },
  { name: "Quarterly", months: 3, discount: 10, interval: "quarter" },
  { name: "Annually", months: 12, discount: 20, interval: "year" },
] as const;
const plans = [
  {
    name: "Pro",
    price: 4000,
    description: "Bring your leads, conversations, and follow-ups together.",
    features: [
      "Lead records and sales pipeline",
      "Standard lead-source integrations",
      "AI chatbot for initial replies and qualification",
      "Basic follow-up sequences and reminders",
      "Manual lead assignment and human handover",
      "Site-visit scheduling and reminders",
      "Lead and pipeline overview",
      "Standard onboarding and support",
    ],
  },
  {
    name: "Pro Plus",
    price: 6000,
    description: "Coordinate your agents with more advanced automation.",
    features: [
      "Everything in Pro",
      "Advanced AI qualification workflows",
      "Multi-step, reply-based follow-ups",
      "Automatic lead routing to agents",
      "Automated site-visit follow-ups",
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
          const monthly = (plan.price * (100 - period.discount)) / 100;
          const total = monthly * period.months;
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
        Prices in INR, before applicable taxes. Team seats, AI usage, storage
        allowances, and any additional messaging or integration charges are
        confirmed before subscription. Contact us to arrange onboarding;
        selecting a plan does not take payment.
      </p>
    </>
  );
}
