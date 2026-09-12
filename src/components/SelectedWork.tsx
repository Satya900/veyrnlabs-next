import { Section } from "./Section";
import { Eyebrow } from "./ui/Eyebrow";

const projects = [
  {
    id: "lead-operations", number: "01", category: "HOSPITALITY & REAL ESTATE", title: "A connected engine for lead operations.",
    intro: "An AI-powered CRM connecting customer conversations, lead qualification, partner operations, and sales visibility.",
    challenge: "A pre-launch business needed a qualification engine before inventory was ready to sell.",
    delivery: "WhatsApp and voice AI, a partner portal, custom analytics, and a direct purchase flow in one operational platform.",
    workflow: ["Conversation", "Qualification", "Human handoff"],
    capabilities: ["Conversational AI", "Custom CRM", "Partner operations"],
    details: [
      ["Customer conversations", "WhatsApp handles brochures, pricing, and common questions. A defined qualification flow keeps the conversation useful, with a human handoff when requested."],
      ["Connected operations", "Voice follow-ups carry the same qualification context. The partner portal brings together identity verification, referrals, and commission tracking."],
      ["Business visibility", "A custom dashboard covers lead sources, lead temperature, partner performance, and funnel conversion."],
    ],
    stack: "WhatsApp Business API · Exotel · Sarvam AI · Claude · PostgreSQL · Redis · Razorpay · Setu/DigiLocker",
  },
  {
    id: "content-operations", number: "02", category: "CONTENT OPERATIONS", title: "From disconnected prompts to a production workflow.",
    intro: "A dedicated AI content-production system built around a client's actual production requirements.",
    challenge: "Content work depended on disconnected manual steps and ad-hoc prompting.",
    delivery: "A defined production workflow delivered as a dedicated system, with the first phase built around the client's requirements.",
    workflow: ["Production brief", "AI workflow", "Content output"],
    capabilities: ["AI content", "Process design", "Workflow automation"],
    details: [
      ["Purpose-built workflow", "The implementation brings content work into a defined process instead of leaving it spread across individual prompts and manual steps."],
      ["Engagement scope", "Phase 1 was built and delivered as a custom content-production system. Client-identifying materials and private implementation details are not published."],
    ],
    stack: null,
  },
];

export function SelectedWork() {
  return (
    <Section id="work" className="portfolio-section">
      <div className="section-heading-row"><div><Eyebrow>Selected work / 01—02</Eyebrow><h2 className="mt-5">Real workflows.<br />Working systems.</h2></div><p>Two delivered systems, both still running. A closer look at the operational problems and the software built to solve them.</p></div>
      <div className="project-list">{projects.map(project => <article className="project-card" id={project.id} key={project.id}>
        <div className="project-visual">
          <div className="project-visual-label"><span>VEYRN / SYSTEM {project.number}</span><span>WORKFLOW SCHEMATIC</span></div>
          <div className="project-console"><div className="console-top"><span className="console-dots" aria-hidden="true">● ● ●</span><span>{project.number === "01" ? "Lead operations" : "Content production"}</span><span className="console-state">SYSTEM VIEW</span></div>
            <div className="console-body">{project.workflow.map((stage, index) => <div className="console-stage" key={stage}><span>0{index + 1}</span><p>{stage}</p><span aria-hidden="true">{index === 2 ? "✓" : "↓"}</span></div>)}</div>
            <div className="console-bottom"><span>DEFINED WORKFLOW</span><span>CONNECTED OPERATIONS ↗</span></div>
          </div>
          <p className="visual-disclosure">Illustrative architecture · client data excluded</p>
        </div>
        <div className="project-story"><div className="project-category"><span>{project.category}</span><span className="delivery-status">Delivered</span></div><h3>{project.title}</h3><p className="project-intro">{project.intro}</p><dl><div><dt>THE CHALLENGE</dt><dd>{project.challenge}</dd></div><div><dt>WHAT WE BUILT</dt><dd>{project.delivery}</dd></div></dl><div className="project-tags">{project.capabilities.map(item => <span key={item}>{item}</span>)}</div>
          <details className="project-details"><summary>Explore the implementation <span aria-hidden="true">+</span></summary><div>{project.details.map(([label, text]) => <section key={label}><h4>{label}</h4><p>{text}</p></section>)}{project.stack && <section><h4>Technology used</h4><p>{project.stack}</p></section>}</div></details>
        </div>
      </article>)}</div>
      <p className="portfolio-note"><span aria-hidden="true">↳</span> Client identities and private project materials are kept confidential.</p>
    </Section>
  );
}
