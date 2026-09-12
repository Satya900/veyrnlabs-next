import { Section } from "./Section";
import { Eyebrow } from "./ui/Eyebrow";

const capabilities = [
  { number: "01", symbol: "↳", title: "AI agents & conversations", body: "Turn customer conversations into useful action, with the context and controls each workflow needs.", examples: ["WhatsApp & voice agents", "Knowledge retrieval & lead qualification", "Context-aware human handoff"], link: "Explore the lead operations platform", href: "#lead-operations" },
  { number: "02", symbol: "⌘", title: "Business software & platforms", body: "Bring the people, information, and decisions behind your operations into a coherent system.", examples: ["Custom CRM & partner portals", "Operational dashboards & analytics", "Payments & identity integrations"], link: "Explore the platform architecture", href: "#lead-operations" },
  { number: "03", symbol: "⇢", title: "Workflow automation", body: "Connect the steps between an idea and a finished result, with clear rules for what happens next.", examples: ["AI content production pipelines", "Multi-step process orchestration", "Validation & exception handling"], link: "Explore the content production system", href: "#content-operations" },
];

export function WhatWeBuild() {
  return (
    <Section id="services">
      <div className="section-heading-row">
        <div><Eyebrow>Capabilities</Eyebrow><h2 className="mt-5">Intelligence, integrated.<br />Operations, connected.</h2></div>
        <p>From a focused automation to the platform around it, we build software that fits the way your business needs to run.</p>
      </div>
      <div className="capability-grid">
        {capabilities.map((item) => (
          <article key={item.number} className="capability-card">
            <div className="capability-top"><span className="service-icon" aria-hidden="true">{item.symbol}</span><span>{item.number} / EXPERTISE</span></div>
            <h3>{item.title}</h3><p>{item.body}</p>
            <ul>{item.examples.map(example => <li key={example}>{example}</li>)}</ul>
            <a href={item.href}>{item.link}<span aria-hidden="true">↗</span></a>
          </article>
        ))}
      </div>
    </Section>
  );
}
