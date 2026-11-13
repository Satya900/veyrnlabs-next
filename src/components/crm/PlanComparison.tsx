import { CRM_PLANS, EXTRA_SEAT_PAISE, type PlanId } from "@/lib/crm/plans";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

const count = (n: number) => n.toLocaleString("en-IN");
export const PLAN_HIGHLIGHTS: Record<PlanId, string[]> = {
  pro: [
    "1 user",
    `${count(CRM_PLANS.pro.aiActions)} AI actions a month (${count(CRM_PLANS.pro.firstMonthAiActions)} in your first month)`,
    "AI reply suggestions in the customer's language, lead details and Hot / Warm / Cold scores",
    "WhatsApp inbox with automatic follow-ups",
    "Book, cancel and reschedule site visits yourself",
    "Try AI auto-replies free for 14 days",
  ],
  pro_plus: [
    "3 users: owner + 2 teammates",
    `${count(CRM_PLANS.pro_plus.aiActions)} AI actions a month, shared (${count(CRM_PLANS.pro_plus.firstMonthAiActions)} in your first month)`,
    "Everything in Pro",
    "AI replies to customers 24/7 in their language and hands over to you when needed",
    "AI books eligible site visits from WhatsApp after checking availability",
    "Lead-source reports and priority support",
  ],
};

export function PlanComparison({ plan, active, role }: { plan: PlanId | null; active: boolean; role: string }) {
  const current = active ? plan : null;
  return <section className="crm-panel">
    <div className="crm-panel-heading"><div><h2>Choose how your team works</h2><p>Both plans include your pipeline, WhatsApp inbox and follow-ups, and AI that reads every chat for you. One AI action is one insight refresh, automatic reply or reply draft.</p></div></div>
    <div className="crm-settings-body">
      <div className="crm-plan-comparison">
        {(["pro", "pro_plus"] as const).map((id) => <article key={id} className={current === id ? "crm-plan-card is-current" : "crm-plan-card"}>
          <div className="crm-plan-card-head"><p className="crm-muted">{id === "pro" ? "AI co-pilot for solo agents" : "AI autopilot for busy agents and teams"}</p>{current === id && <span className="crm-badge won">Current plan</span>}</div>
          <h3>{CRM_PLANS[id].name}</h3><p className="crm-plan-price">{rupees(CRM_PLANS[id].monthlyPaise)}<small> /month + GST</small></p>
          <ul>{PLAN_HIGHLIGHTS[id].map((feature) => <li key={feature}>{feature}</li>)}</ul>
        </article>)}
      </div>
      <p className="crm-plan-example">For a three-person team on monthly billing: Pro with two extra seats costs {rupees(CRM_PLANS.pro.monthlyPaise + 2 * EXTRA_SEAT_PAISE)}/month. Pro Plus costs {rupees(CRM_PLANS.pro_plus.monthlyPaise)}/month and adds three times the AI actions, 24/7 AI replies, automatic site-visit booking and source reports.</p>
      <p className="crm-muted">Base plans save 10% quarterly or 20% annually, paid upfront. Extra seats are {rupees(EXTRA_SEAT_PAISE)}/user/month. AI actions reset each month; unused ones don&apos;t carry over.</p>
      {current === "pro" && <p>{role === "owner" ? <>Want Pro Plus? <a href="mailto:satyabrata@veyrnlabs.com?subject=Pro%20Plus%20plan%20change">Request a plan change</a>. We’ll confirm the timing and charges before changing your subscription.</> : "Ask your workspace owner about Pro Plus."}</p>}
    </div>
  </section>;
}
