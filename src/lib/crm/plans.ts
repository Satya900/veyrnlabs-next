export const CRM_PLANS = {
  pro: {
    name: "Pro",
    monthlyPaise: 400_000,
    includedSeats: 1,
    automaticScheduling: false,
  },
  pro_plus: {
    name: "Pro Plus",
    monthlyPaise: 600_000,
    includedSeats: 3,
    automaticScheduling: true,
  },
} as const;
export type PlanId = keyof typeof CRM_PLANS;
export type BillingMonths = 1 | 3 | 12;
export const BILLING_DISCOUNTS = { 1: 0, 3: 10, 12: 20 } as const;

export function planPrice(plan: PlanId, months: BillingMonths) {
  if (
    !Object.hasOwn(CRM_PLANS, plan) ||
    !Object.hasOwn(BILLING_DISCOUNTS, months)
  )
    throw new Error("Invalid subscription plan.");
  const monthlyPaise =
    (CRM_PLANS[plan].monthlyPaise * (100 - BILLING_DISCOUNTS[months])) / 100;
  return { monthlyPaise, totalPaise: monthlyPaise * months };
}

export type BillingStatus =
  | "created"
  | "authenticated"
  | "active"
  | "pending"
  | "halted"
  | "cancelled"
  | "completed"
  | "paused"
  | "expired";
export type UsageSummary = {
  seat_subscriptions?: { id: string; quantity: number; status: string }[];
  trial?: boolean;
  status: "unconfigured" | "inactive" | "active";
  billing_status?: BillingStatus | null;
  plan?: PlanId;
  billing_months?: BillingMonths;
  included_seats?: number;
  purchased_seats?: number;
  member_count?: number;
  automatic_scheduling?: boolean;
  period_end?: string;
  ai_limit?: number;
  ai_used?: number;
  whatsapp_limit?: number;
  whatsapp_used?: number;
  automation_paused?: boolean;
};
