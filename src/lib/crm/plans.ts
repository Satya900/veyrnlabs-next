// Prices are an explicit table (paise per month, GST extra), not a computed discount, so
// every billed total is a whole rupee amount that matches its Razorpay Plan exactly.
// Keep in sync with crm_plan_monthly_paise and crm_seat_monthly_paise in the database.
export const CRM_PLANS = {
  pro: {
    name: "Pro",
    monthlyPaise: 49_900,
    periodMonthlyPaise: { 1: 49_900, 3: 44_900, 12: 39_900 },
    includedSeats: 1,
    automaticScheduling: false,
  },
  pro_plus: {
    name: "Pro Plus",
    monthlyPaise: 69_900,
    periodMonthlyPaise: { 1: 69_900, 3: 62_900, 12: 55_900 },
    includedSeats: 3,
    automaticScheduling: true,
  },
} as const;
export const EXTRA_SEAT_PAISE = 19_900;
export type PlanId = keyof typeof CRM_PLANS;
export type BillingMonths = 1 | 3 | 12;
// Advertised savings for each prepay period; the price table above rounds to whole rupees.
export const BILLING_DISCOUNTS = { 1: 0, 3: 10, 12: 20 } as const;

export function planPrice(plan: PlanId, months: BillingMonths) {
  if (
    !Object.hasOwn(CRM_PLANS, plan) ||
    !Object.hasOwn(BILLING_DISCOUNTS, months)
  )
    throw new Error("Invalid subscription plan.");
  const monthlyPaise = CRM_PLANS[plan].periodMonthlyPaise[months];
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
  seat_subscriptions?: {
    id: string;
    quantity: number;
    status: string;
    unit_paise?: number | null;
  }[];
  billing_unavailable?: boolean;
  billing?: {
    plan: PlanId;
    billing_months: BillingMonths;
    amount_paise: number;
    status: BillingStatus;
  };
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
