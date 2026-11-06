import { CRM_PLANS, EXTRA_SEAT_PAISE, type PlanId } from "@/lib/crm/plans";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

export const PLAN_HIGHLIGHTS: Record<PlanId, string[]> = {
  pro: ["1 included user", "Manually book, cancel and reschedule site visits", "Lead and pipeline overview"],
  pro_plus: ["3 included users: owner + 2 teammates", "AI books eligible site visits from WhatsApp after checking availability", "Lead-source performance reports to see what converts"],
};

export function PlanComparison({ plan, active, role }: { plan: PlanId | null; active: boolean; role: string }) {
  const current = active ? plan : null;
  return <section className="crm-panel">
    <div className="crm-panel-heading"><div><h2>Choose how your team works</h2><p>Both plans include your pipeline, AI reply drafts, WhatsApp tools and automatic email follow-ups within defined usage allowances.</p></div></div>
    <div className="crm-settings-body">
      <div className="crm-plan-comparison">
        {(["pro", "pro_plus"] as const).map((id) => <article key={id} className={id === "pro_plus" ? "crm-plan-card is-plus" : "crm-plan-card"}>
          <p className="crm-muted">{id === "pro" ? "For independent agents" : "For growing teams"}{current === id ? " · Current plan" : ""}</p>
          <h3>{CRM_PLANS[id].name}</h3><p className="crm-plan-price">{rupees(CRM_PLANS[id].monthlyPaise)}<small> /month + GST</small></p>
          <ul>{PLAN_HIGHLIGHTS[id].map((feature) => <li key={feature}>{feature}</li>)}</ul>
        </article>)}
      </div>
      <p>For a three-person team on monthly billing: Pro with two extra seats costs {rupees(CRM_PLANS.pro.monthlyPaise + 2 * EXTRA_SEAT_PAISE)}/month. Pro Plus costs {rupees(CRM_PLANS.pro_plus.monthlyPaise)}/month and adds automatic site-visit booking and source reports.</p>
      <p className="crm-muted">Base plans save 10% quarterly or 20% annually, paid upfront. Extra seats are {rupees(EXTRA_SEAT_PAISE)}/user/month. AI and messaging are never unlimited.</p>
      {current === "pro" && <p>{role === "owner" ? <>Want Pro Plus? <a href="mailto:satyabrata@veyrnlabs.com?subject=Pro%20Plus%20plan%20change">Request a plan change</a>. We’ll confirm the timing and charges before changing your subscription.</> : "Ask your workspace owner about Pro Plus."}</p>}
    </div>
  </section>;
}
