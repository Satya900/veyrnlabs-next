import { Section } from "./Section";
import { Eyebrow } from "./ui/Eyebrow";

const questions = [
  ["What kinds of projects are a good fit?", "Projects where AI needs to work inside an actual business process: lead qualification, customer conversations, content production, CRM workflows, partner operations, and the custom software connecting them."],
  ["Can you work with our existing tools?", "Yes. We start by understanding the existing workflow and the integrations it needs. API access, data quality, and platform constraints are assessed before the implementation scope is agreed."],
  ["How do you approach AI reliability?", "The model proposes an action and the system validates it before execution. We use workflow-specific evaluation cases, explicit rules, and human handoff paths to define where automation can act and when it should stop."],
  ["How are cost and timelines determined?", "They depend on the workflow, integrations, data readiness, and acceptance criteria. We scope those together before committing to a delivery plan or price. A focused first phase can establish the right direction before a broader build."],
  ["Who will I work with?", "You work directly with Satyabrata Mohanty, the founder and engineer responsible for the systems featured here. That keeps technical decisions and project context close to the work."],
  ["Can you share client work?", "The public case studies describe the delivered systems without identifying clients or exposing private data. Any additional project material can only be shared with the relevant client's permission."],
];

export function FAQ() {
  return <Section id="faq"><div className="faq-layout"><div><Eyebrow>Before we begin</Eyebrow><h2 className="mt-5">Good questions.<br />Clear answers.</h2><p className="mt-6 text-body">The practical details of working together.</p></div><div>{questions.map(([question, answer], i) => <details className="faq-item" key={question}><summary><span className="faq-number">0{i + 1}</span>{question}<span className="faq-toggle" aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></div></Section>;
}
