import { Section } from "./Section";
import { Eyebrow } from "./ui/Eyebrow";

const phases = [
  { title: "Understand", text: "Map the workflow, its users, and the points where work gets stuck.", output: "Workflow map & scoped requirements" },
  { title: "Build", text: "Develop the application, integrations, and AI around the agreed process.", output: "Working system & connected integrations" },
  { title: "Verify", text: "Challenge assumptions, test failure paths, and fix what breaks.", output: "Evaluation cases & validation checks" },
  { title: "Deliver", text: "Put the verified workflow into use, with the operating boundaries made clear.", output: "Production workflow & engineering handover" },
];

export function HowWeWork() {
  return (
    <Section id="process">
      <div className="section-heading-row"><div><Eyebrow>Delivery approach</Eyebrow><h2 className="mt-5">A clear path from<br />complexity to production.</h2></div><p>Each stage has a purpose. Scope, acceptance criteria, and handover requirements are agreed around your project.</p></div>
      <div className="process-grid">{phases.map((phase, i) => <article key={phase.title}><span className="phase-number">0{i + 1}</span><h3>{phase.title}</h3><p>{phase.text}</p><div className="phase-output"><span>DELIVERABLE</span>{phase.output}</div></article>)}</div>
    </Section>
  );
}
