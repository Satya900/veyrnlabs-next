import { Section } from "./Section";
import { Eyebrow } from "./ui/Eyebrow";

const checks = [
  ["Workflow-specific evaluation", "Test against the tasks the system must complete and the failure cases it needs to handle."],
  ["Validation before action", "Check the proposed action against explicit policy before it affects a customer or business record."],
  ["Human control & traceability", "Make escalation paths clear and preserve the context needed to understand a decision."],
];

export function AiProposes() {
  return (
    <Section id="quality">
      <div className="quality-layout"><div><Eyebrow>The engineering standard</Eyebrow><h2 className="mt-5">Quality is part of<br />the architecture.</h2><p className="prose-measure mt-6 text-body">A useful AI system needs more than a convincing response. Our approach connects intelligence to explicit rules, observable decisions, and the people responsible for the outcome.</p><div className="quality-flow"><span>AI proposes</span><span aria-hidden="true">→</span><strong>System validates</strong><span aria-hidden="true">→</span><span>Action executes</span></div></div><div className="quality-checks">{checks.map(([title, body], i) => <article key={title}><span className="quality-check-number">0{i + 1}</span><div><h3>{title}</h3><p>{body}</p></div></article>)}</div></div>
    </Section>
  );
}
