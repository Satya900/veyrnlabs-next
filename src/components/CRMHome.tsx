import { Section } from "./Section";
import { ButtonLink } from "./ui/Button";
import { Pricing } from "@/app/product/real-estate-crm-software/Pricing";
import { site } from "@/lib/site";

export function CRMHome() {
  return (
    <>
      <section id="top" className="hero-shell">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">
              <span className="status-dot" />
              Veyrn CRM · For real estate teams
            </p>
            <h1>
              More clarity.
              <br />
              Better follow-ups.
              <br />
              <span>Every property lead.</span>
            </h1>
            <p className="hero-description">
              Keep enquiries, client conversations, and your team’s next actions
              in one place. A focused CRM for the way real estate teams work.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="#pricing" variant="primary">
                Explore plans ↓
              </ButtonLink>
              <ButtonLink href="#contact">Request onboarding ↗</ButtonLink>
            </div>
            <p className="hero-note">
              Pro and Pro Plus · Monthly, quarterly, or annual billing
            </p>
          </div>
          <div
            className="system-scene"
            aria-label="Illustrative real estate CRM workflow"
          >
            <div className="scene-caption">
              <span>VEYRN CRM</span>
              <span>ILLUSTRATIVE WORKSPACE</span>
            </div>
            <h2 className="my-8 text-3xl tracking-tight">
              A place for every next step.
            </h2>
            <div className="trace-panel">
              <div className="trace-heading">
                <span>Property enquiry</span>
                <span className="trace-badge">BUYER</span>
              </div>
              <div className="trace-events">
                {[
                  [
                    "01",
                    "Requirements recorded",
                    "2-bedroom apartment · Preferred area and budget",
                  ],
                  [
                    "02",
                    "Conversation in context",
                    "Notes and activity alongside the lead",
                  ],
                  [
                    "03",
                    "Next action assigned",
                    "Agent to confirm a property shortlist",
                  ],
                ].map(([n, h, p]) => (
                  <div
                    key={n}
                    className={`trace-event ${n === "03" ? "is-verified" : ""}`}
                  >
                    <span className="event-number">{n}</span>
                    <div>
                      <p>{h}</p>
                      <span>{p}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="trace-footer">
                <span>LEAD CONTEXT</span>
                <span>OWNER + NEXT ACTION</span>
              </div>
            </div>
            <p className="scene-note">
              From the first enquiry to a clear follow-up.
            </p>
          </div>
        </div>
      </section>
      <Section id="features">
        <p className="section-eyebrow">Your daily sales workspace</p>
        <h2 className="mt-6">
          Less searching through messages.
          <br />
          More moving leads forward.
        </h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {[
            [
              "Lead management",
              "Keep contact details, requirements, ownership, and pipeline stages together so your team knows where each enquiry stands.",
            ],
            [
              "Follow-up organisation",
              "Track next actions and due dates. Give agents a clear view of the conversations that need their attention.",
            ],
            [
              "Client context",
              "Keep activity and notes alongside each lead, so the next conversation starts with the right background.",
            ],
          ].map(([h, p]) => (
            <article className="border-t border-hairline pt-6" key={h}>
              <h3 className="text-2xl tracking-tight">{h}</h3>
              <p className="mt-4 text-sm leading-7 text-body">{p}</p>
            </article>
          ))}
        </div>
      </Section>
      <Section id="automation">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <p className="section-eyebrow">The AI direction</p>
            <h2 className="mt-6">
              An enquiry at 1 AM.
              <br />A clear next step at 9.
            </h2>
          </div>
          <div className="space-y-5 text-body leading-8">
            <p>
              We’re building toward AI-assisted initial replies, requirement
              collection, and follow-up workflows for real estate enquiries.
            </p>
            <p>
              Your agents stay in control of the relationship. Responses should
              use approved property information, with human handover when
              needed.
            </p>
            <p className="border-l-2 border-primary pl-5 text-sm">
              AI automation and source integrations are being prepared for
              product onboarding. We confirm availability for your account
              before you subscribe.
            </p>
          </div>
        </div>
      </Section>
      <Section id="pricing">
        <div className="text-center">
          <p className="section-eyebrow">Choose your plan</p>
          <h2 className="mx-auto my-6">
            Start with Pro.
            <br />
            Go further with Pro Plus.
          </h2>
          <p className="mx-auto max-w-xl text-body leading-8">
            Compare the proposed plans and request onboarding. Save 10% with
            quarterly billing or 20% with annual billing.
          </p>
        </div>
        <Pricing />
      </Section>
      <Section id="onboarding">
        <p className="section-eyebrow">Get started with guidance</p>
        <h2 className="mt-6">A considered start for your team.</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {[
            [
              "01",
              "Tell us about your team",
              "Share your team size, lead sources, and current tools so we can check the product fits your needs.",
            ],
            [
              "02",
              "Confirm the plan",
              "We confirm available features, usage allowances, integrations, and billing terms before payment.",
            ],
            [
              "03",
              "Prepare your workspace",
              "We coordinate setup and onboarding once a customer workspace is ready. Access is arranged with you directly.",
            ],
          ].map(([n, h, p]) => (
            <article className="border-t border-hairline pt-6" key={n}>
              <span className="text-primary text-xs">{n}</span>
              <h3 className="mt-5 text-2xl tracking-tight">{h}</h3>
              <p className="mt-4 text-sm leading-7 text-body">{p}</p>
            </article>
          ))}
        </div>
      </Section>
      <Section id="faq">
        <p className="section-eyebrow">Questions, answered</p>
        <h2 className="mt-6">Meet your next CRM.</h2>
        <div className="mt-8 max-w-3xl">
          {[
            [
              "Who is Veyrn CRM for?",
              "Our first focus is real estate agents and agencies that need a clearer way to organise property enquiries, client context, and follow-ups.",
            ],
            [
              "Can I sign up and pay online today?",
              "Onboarding is currently arranged with our team. Self-service customer signup and subscription checkout are not yet available. Request onboarding to discuss availability and the setup process.",
            ],
            [
              "What is the difference between Pro and Pro Plus?",
              "Pro covers the proposed everyday lead-management and basic follow-up workflows. Pro Plus adds advanced automation, lead routing, and team reporting. We confirm current availability and usage allowances before subscription.",
            ],
            [
              "Will this replace my messaging tools?",
              "The goal is to keep lead context and next actions organised alongside your communication channels. Supported sources and any provider charges are confirmed during onboarding.",
            ],
            [
              "Can you still build a custom CRM?",
              "Custom development remains a separate service for bespoke requirements. Our primary product focus is now Veyrn CRM for real estate teams.",
            ],
          ].map(([q, a]) => (
            <details className="border-b border-hairline py-6" key={q}>
              <summary className="cursor-pointer text-lg focus-visible:outline-2 focus-visible:outline-primary">
                {q}
              </summary>
              <p className="mt-4 text-sm leading-8 text-body">{a}</p>
            </details>
          ))}
        </div>
      </Section>
      <Section id="contact">
        <div className="text-center">
          <p className="section-eyebrow">Your next step</p>
          <h2 className="mx-auto my-6">
            Bring your real estate
            <br />
            workflow into focus.
          </h2>
          <p className="mx-auto max-w-xl text-body leading-8">
            Tell us about your agency, lead sources, and team. We’ll confirm the
            right starting point for onboarding.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink
              href={`mailto:${site.email}?subject=${encodeURIComponent("Veyrn CRM onboarding")}`}
              variant="primary"
            >
              Request onboarding ↗
            </ButtonLink>
            <ButtonLink href="/product/real-estate-crm">
              Discuss a custom build
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
