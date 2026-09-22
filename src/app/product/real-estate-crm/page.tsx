import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Section } from "@/components/Section";
import { ButtonLink } from "@/components/ui/Button";
import { site, siteUrl } from "@/lib/site";
import styles from "./product.module.css";

const title = "Custom AI Real Estate CRM | Veyrn Labs";
const description =
  "A real estate CRM built around your business. Connect lead sources, respond with AI, automate follow-ups, and give your agents a clear next step.";
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: siteUrl("/product/real-estate-crm") },
  openGraph: {
    title,
    description,
    type: "website",
    url: siteUrl("/product/real-estate-crm"),
    siteName: site.name,
  },
  twitter: { card: "summary_large_image", title, description },
};

const steps = [
  [
    "Capture every enquiry",
    "Bring connected lead sources into one record. Keep the source, contact details, conversation history, and assigned agent together.",
  ],
  [
    "Start the conversation",
    "At 1 PM or 1 AM, an AI chatbot can acknowledge enquiries and answer questions using your approved business and property information.",
  ],
  [
    "Understand the requirement",
    "Collect location, property type, budget, and buying or renting timeline. Give your agents context before they pick up the phone.",
  ],
  [
    "Keep the follow-up moving",
    "Build reminders and follow-up sequences around lead stage, replies, and working hours. Pause automation when an agent takes over and respect opt-outs.",
  ],
  [
    "Hand over with context",
    "Route enquiries to the right person with a conversation summary and next action. Escalate questions the AI cannot confidently answer.",
  ],
];
const plans = [
  {
    name: "Essentials",
    caption: "Organise your enquiries",
    audience: "For independent agents and small teams.",
    items: [
      "Central lead inbox and contact records",
      "Pipeline stages tailored to your process",
      "AI chatbot for initial replies and basic qualification",
      "Basic automated follow-ups and agent reminders",
      "Manual lead assignment and human handover",
      "Lead status and follow-up overview",
    ],
  },
  {
    name: "Growth",
    caption: "Connect your sales workflow",
    audience: "For agencies managing more leads and agents.",
    items: [
      "Everything in Essentials",
      "Deeper qualification and lead prioritisation",
      "Multi-step follow-ups based on replies and stage",
      "Automatic agent assignment",
      "Site-visit scheduling workflows",
      "Property matching from connected inventory",
      "Lead-source and agent activity reporting",
    ],
  },
  {
    name: "Scale",
    caption: "Coordinate teams and branches",
    audience: "For multi-branch agencies and property developers.",
    items: [
      "Everything in Growth",
      "Custom AI workflows by team or project",
      "Branch routing and escalation rules",
      "Roles, permissions, and manager oversight",
      "Multiple projects and inventory sources",
      "Re-engagement workflows for older enquiries",
      "Custom integrations, reporting, and onboarding",
    ],
  },
];
const faqs = [
  [
    "Is this a ready-made CRM subscription?",
    "No. We build a custom CRM around your real estate business. The three plans are starting points for discussing scope. Your workflows, integrations, and requirements shape the final build.",
  ],
  [
    "Which lead sources can you connect?",
    "We can scope connections for Meta lead ads, website forms, WhatsApp, property portals, and imports. Each connection depends on the provider’s API access, account permissions, and available integrations. We confirm feasibility before agreeing the build.",
  ],
  [
    "What can the AI say to a lead?",
    "We define its answers, qualification questions, and escalation rules with you. Property details and availability should come from approved, up-to-date sources. When information is missing or a person is needed, the workflow hands over to your team.",
  ],
  [
    "Can my agents take over a conversation?",
    "Yes. Human handover is part of the proposed workflow. We design how agents are notified, what context they receive, and when automated messages pause so the conversation stays coordinated.",
  ],
  [
    "Can you migrate our existing leads?",
    "We review your current CRM or spreadsheets, map fields and stages, and agree a migration plan. Import scope, duplicate handling, and any historical conversation data depend on what your current system can export.",
  ],
  [
    "How do we get started?",
    "Share your lead sources, team size, current follow-up process, and the problems you want to solve. We discuss your requirements, map the workflow, and prepare a tailored scope and proposal. Delivery timing and costs are agreed after that discussion.",
  ],
];
const emailLink = (plan?: string) =>
  `mailto:${site.email}?subject=${encodeURIComponent(plan ? `Custom real estate CRM: ${plan}` : "Custom real estate CRM requirements")}&body=${encodeURIComponent("Hi Veyrn Labs,\n\nI would like to discuss a custom real estate CRM.\n\nBusiness name:\nTeam size:\nCurrent lead sources:\nCurrent CRM or tools:\nMain challenges:\n")}`;

export default function RealEstateCRM() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className="eyebrow">
              <span className="status-dot" />
              Custom-built for real estate
            </p>
            <h1>
              Your next enquiry
              <br />
              won’t wait
              <br />
              <span>until morning.</span>
            </h1>
            <p className={styles.intro}>
              At 1 PM or 1 AM, keep the conversation moving. We build AI-powered
              CRMs that capture enquiries, handle initial conversations, and
              organise every next step around your business.
            </p>
            <div className={styles.actions}>
              <ButtonLink href="#requirements" variant="primary">
                Discuss your requirements <span aria-hidden="true">↗</span>
              </ButtonLink>
              <ButtonLink href="#plans">
                Explore plans <span aria-hidden="true">↓</span>
              </ButtonLink>
            </div>
            <p className={styles.note}>
              Your lead sources. Your sales process. A CRM built to fit.
            </p>
          </div>
          <div
            className={styles.story}
            aria-label="Illustrative overnight enquiry workflow"
          >
            <div className={styles.storyHeader}>
              <span>AFTER HOURS. STILL CONNECTED.</span>
              <span className="status-dot" />
            </div>
            <div className={styles.clock}>
              01:00 <span>AM</span>
            </div>
            <p className={styles.storyLabel}>
              An enquiry arrives. A conversation begins.
            </p>
            <div className={styles.message}>
              <span>NEW WEBSITE ENQUIRY</span>
              <p>
                Hi, I’m looking for a two-bedroom apartment. Can someone help?
              </p>
            </div>
            <div className={`${styles.message} ${styles.reply}`}>
              <span>AI ASSISTANT</span>
              <p>
                Of course. Which area are you considering, and what budget do
                you have in mind?
              </p>
            </div>
            <div className={styles.record}>
              <span>LEAD RECORD UPDATED</span>
              <p>2 bedrooms · Location & budget captured</p>
              <div>
                <span>Next action</span>
                <strong>Agent follow-up in the morning ↗</strong>
              </div>
            </div>
            <p className={styles.note}>
              Illustrative workflow · Built around your response and handover
              rules.
            </p>
          </div>
        </section>

        <Section id="lead-sources">
          <p className="section-eyebrow">One connected view</p>
          <h2 className="mt-6">
            Different sources.
            <br />
            One clear picture of every lead.
          </h2>
          <p className="prose-measure mt-6 text-body">
            A form submission, a chat message, or an imported contact should
            lead to an organised next step. We connect the sources your team
            uses and keep the context together.
          </p>
          <div className={styles.sources}>
            {[
              "Meta lead ads",
              "Website forms",
              "WhatsApp",
              "Property portals",
              "Manual entries & imports",
            ].map((source) => (
              <span key={source}>{source}</span>
            ))}
          </div>
          <div className={styles.pipeline}>
            <p>YOUR CUSTOM LEAD PIPELINE</p>
            <div>
              {[
                "New enquiry",
                "Qualified",
                "Visit scheduled",
                "Negotiation",
                "Closed",
              ].map((stage, i) => (
                <span key={stage}>
                  <small>0{i + 1}</small>
                  {stage}
                </span>
              ))}
            </div>
          </div>
          <p className={styles.note}>
            Connections are scoped around provider access and permissions.
            Pipeline stages are tailored to your process.
          </p>
        </Section>

        <Section id="workflow">
          <div className={styles.workflow}>
            <div>
              <p className="section-eyebrow">From enquiry to next step</p>
              <h2 className="mt-6">
                Less chasing.
                <br />
                More context.
              </h2>
              <p className="prose-measure mt-6 text-body">
                Give every enquiry a place, every conversation a history, and
                every agent a clear next action.
              </p>
            </div>
            <ol className={styles.steps}>
              {steps.map(([heading, body], i) => (
                <li key={heading}>
                  <span>0{i + 1}</span>
                  <div>
                    <h3>{heading}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Section>

        <Section id="plans">
          <p className="section-eyebrow">Three starting points</p>
          <h2 className="mt-6">
            Built for the way
            <br />
            your business works.
          </h2>
          <p className="prose-measure mt-6 text-body">
            Start with the scope closest to your needs. We tailor the features,
            integrations, and implementation to your use case, then prepare a
            proposal.
          </p>
          <div className={styles.plans}>
            {plans.map((plan, i) => (
              <article
                key={plan.name}
                className={`${styles.plan} ${i === 1 ? styles.featured : ""}`}
              >
                <p className={styles.planNumber}>0{i + 1} / CUSTOM CRM</p>
                <h3>{plan.name}</h3>
                <p className={styles.caption}>{plan.caption}</p>
                <p className={styles.audience}>{plan.audience}</p>
                <ul>
                  {plan.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <ButtonLink
                  href={emailLink(plan.name)}
                  variant={i === 1 ? "primary" : "outline"}
                  aria-label={`Discuss the ${plan.name} plan`}
                >
                  Discuss this plan <span aria-hidden="true">↗</span>
                </ButtonLink>
              </article>
            ))}
          </div>
          <p className={styles.note}>
            Each plan describes a potential build scope. Final capabilities,
            channel costs, hosting, and support are agreed in your proposal.
          </p>
        </Section>

        <Section id="build-process">
          <p className="section-eyebrow">Made around your use case</p>
          <h2 className="mt-6">
            Your process comes first.
            <br />
            The software follows.
          </h2>
          <div className={styles.buildSteps}>
            {[
              [
                "01",
                "Map your workflow",
                "We understand your lead sources, team structure, follow-up gaps, and the outcomes you need.",
              ],
              [
                "02",
                "Define your build",
                "Together we agree the pipeline, AI behaviour, integrations, access controls, and delivery scope.",
              ],
              [
                "03",
                "Build, verify, onboard",
                "We implement and test the agreed workflows, prepare your data, and help your team get started.",
              ],
            ].map(([n, h, p]) => (
              <div key={n}>
                <span>{n}</span>
                <h3>{h}</h3>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="product-faq">
          <p className="section-eyebrow">Before we build</p>
          <h2 className="mt-6">A few useful answers.</h2>
          <div className={styles.faq}>
            {faqs.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </Section>

        <Section id="requirements">
          <div className={styles.contact}>
            <p className="section-eyebrow">Let’s map your CRM</p>
            <h2>
              A better follow-up process
              <br />
              starts with your requirements.
            </h2>
            <p>
              Tell us where your leads come from, how your team works, and what
              gets missed today. We’ll help define a custom CRM around it.
            </p>
            <div className={styles.actions}>
              <ButtonLink href={emailLink()} variant="primary">
                Share your requirements <span aria-hidden="true">↗</span>
              </ButtonLink>
              <ButtonLink href={site.discoveryCallUrl}>
                Schedule a requirements call <span aria-hidden="true">↗</span>
              </ButtonLink>
            </div>
            <a className={styles.email} href={emailLink()}>
              {site.email}
            </a>
          </div>
        </Section>
      </main>
      <Footer />
    </>
  );
}
