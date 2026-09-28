import { CRM_PLANS, type PlanId } from "@/lib/crm/plans";

export function PlanComparison({ plan, role }: { plan: PlanId | null; role: string }) {
  return <section className="crm-panel">
    <div className="crm-panel-heading"><div><h2>Choose how your team works</h2><p>Both plans include your pipeline, AI reply drafts, WhatsApp tools and automatic email follow-ups within defined usage allowances.</p></div></div>
    <div className="crm-settings-body">
      <div className="crm-plan-comparison">
        {(["pro", "pro_plus"] as const).map((id) => <article key={id} className={id === "pro_plus" ? "crm-plan-card is-plus" : "crm-plan-card"}>
          <p className="crm-muted">{id === "pro" ? "For independent agents" : "For growing teams"}{plan === id ? " · Current plan" : ""}</p>
          <h3>{CRM_PLANS[id].name}</h3><p className="crm-plan-price">₹{(CRM_PLANS[id].monthlyPaise / 100).toLocaleString("en-IN")}<small> /month</small></p>
          <ul>{(id === "pro" ? ["1 included user", "Manually book, cancel and reschedule site visits", "Lead and pipeline overview"] : ["3 included users: owner + 2 teammates", "AI books eligible site visits from WhatsApp after checking availability", "Lead-source performance reports to see what converts"]).map((feature) => <li key={feature}>{feature}</li>)}</ul>
        </article>)}
      </div>
      <p>For a three-person team on monthly billing: Pro with two extra seats costs ₹5,000/month. Pro Plus costs ₹6,000/month and adds automatic site-visit booking and source reports.</p>
      <p className="crm-muted">Base plans save 10% quarterly or 20% annually, paid upfront. Extra seats stay ₹500/user/month. AI and messaging are never unlimited.</p>
      {plan === "pro" && <p>{role === "owner" ? <>Want Pro Plus? <a href="mailto:satyabrata@veyrnlabs.com?subject=Pro%20Plus%20plan%20change">Request a plan change</a>. We’ll confirm the timing and charges before changing your subscription.</> : "Ask your workspace owner about Pro Plus."}</p>}
    </div>
  </section>;
}
