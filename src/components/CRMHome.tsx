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
              <ButtonLink href="/crm/signup" variant="primary">
                Get started free ↗
              </ButtonLink>
              <ButtonLink href="#pricing">Explore plans ↓</ButtonLink>
            </div>
            <p className="hero-note">
              Free lead management, or Pro / Pro Plus · Monthly, quarterly, or
              annual billing
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
              AI-assisted WhatsApp replies, requirement collection, and
              follow-up drafting for real estate enquiries, using your own
              company and property information.
            </p>
            <p>
              Your agents stay in control of the relationship. Responses use
              only the knowledge you provide, with human handover whenever a
              conversation needs a person.
            </p>
            <p className="border-l-2 border-primary pl-5 text-sm">
              Pro and Pro Plus include defined AI and messaging allowances per
              billing period, shown in your workspace before you subscribe.
            </p>
          </div>
        </div>
      </Section>
      <Section id="pricing">
        <div className="text-center">
          <p className="section-eyebrow">Choose your plan</p>
          <h2 className="mx-auto my-6">
            Start free.
            <br />
            Grow into Pro or Pro Plus.
          </h2>
          <p className="mx-auto max-w-xl text-body leading-8">
            Manage leads for free, no card required. Subscribe any time for AI
            replies, automation, and team features. Save 10% with quarterly
            billing or 20% with annual billing.
          </p>
        </div>
        <Pricing />
      </Section>
      <Section id="onboarding">
        <p className="section-eyebrow">Get started in minutes</p>
        <h2 className="mt-6">A straightforward start for your team.</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {[
            [
              "01",
              "Create your free account",
              "Sign up with your work email and business name. No card required, no waiting for setup.",
            ],
            [
              "02",
              "Start managing leads",
              "Add your leads and clients, set your pipeline stages, and invite your team right away.",
            ],
            [
              "03",
              "Subscribe when you're ready",
              "Move to Pro or Pro Plus any time from Settings to unlock AI replies, WhatsApp, and automation.",
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
              "Yes. Create a free account any time, no card required, and manage your leads immediately. Subscribing to Pro or Pro Plus opens secure checkout with Razorpay directly from your workspace.",
            ],
            [
              "What is the difference between Pro and Pro Plus?",
              "Pro covers everyday lead management and basic follow-up workflows with one included user. Pro Plus adds advanced AI automation, lead routing, automatic scheduling, and team reporting for up to three included users.",
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
          <p className="section-eyebrow">Prefer to talk first?</p>
          <h2 className="mx-auto my-6">
            Bring your real estate
            <br />
            workflow into focus.
          </h2>
          <p className="mx-auto max-w-xl text-body leading-8">
            Most teams just sign up and start. If you’d rather talk through
            your agency, lead sources, and team size first, we’re glad to help.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/crm/signup" variant="primary">
              Get started free ↗
            </ButtonLink>
            <ButtonLink
              href={`mailto:${site.email}?subject=${encodeURIComponent("Veyrn CRM onboarding")}`}
            >
              Talk to us first
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
