import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Section } from "@/components/Section";
import { ButtonLink } from "@/components/ui/Button";
import { site, siteUrl } from "@/lib/site";
import { Pricing } from "./Pricing";
import styles from "./pricing.module.css";

const title = "AI Real Estate CRM Software & Pricing | Veyrn Labs";
const description =
  "Organise real estate leads and automate follow-ups with Veyrn CRM. Pro from ₹4,000/month and Pro Plus from ₹6,000/month, with quarterly and annual savings.";
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: siteUrl("/product/real-estate-crm-software") },
  openGraph: {
    title,
    description,
    type: "website",
    siteName: site.name,
    url: siteUrl("/product/real-estate-crm-software"),
  },
  twitter: { card: "summary_large_image", title, description },
};

export default function CRMSoftwarePage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <section className={styles.hero}>
          <p className="eyebrow">
            <span className="status-dot" />
            Veyrn CRM / Real estate
          </p>
          <h1>
            Every enquiry.
            <br />A clearer <span>next step.</span>
          </h1>
          <p className={styles.intro}>
            One workspace for your property leads, AI conversations, and
            follow-ups. Give your team the context to move each opportunity
            forward, even when the first enquiry arrives after hours.
          </p>
          <div className={styles.actions}>
            <ButtonLink href="#pricing" variant="primary">
              Find your plan <span aria-hidden="true">↓</span>
            </ButtonLink>
            <Link href="/product/real-estate-crm">Need a custom CRM? ↗</Link>
          </div>
          <div className={styles.strip}>
            <span>AI-assisted conversations</span>
            <span>Organised follow-ups</span>
            <span>Standard onboarding included</span>
          </div>
        </section>
        <Section id="pricing">
          <div className={styles.heading}>
            <p className="section-eyebrow">Simple plans. Clear next steps.</p>
            <h2>
              Choose your plan.
              <br />
              Make it your daily workspace.
            </h2>
            <p>
              Start with Pro for everyday lead management, or choose Pro Plus
              for advanced workflows and team visibility.
            </p>
          </div>
          <Pricing />
        </Section>
        <Section id="crm-workflow">
          <p className="section-eyebrow">From first message to follow-up</p>
          <h2 className="mt-6">Keep the conversation moving.</h2>
          <div className={styles.workflow}>
            {[
              [
                "01",
                "Bring leads together",
                "Keep enquiries from your connected sources in one pipeline, with contact details and conversation history.",
              ],
              [
                "02",
                "Let AI start the conversation",
                "Handle initial questions and collect property requirements using your approved information, with human handover when needed.",
              ],
              [
                "03",
                "Give every lead a next action",
                "Use follow-up sequences, reminders, and site-visit scheduling to help your agents stay organised.",
              ],
            ].map(([n, h, p]) => (
              <article key={n}>
                <span>{n}</span>
                <h3>{h}</h3>
                <p>{p}</p>
              </article>
            ))}
          </div>
        </Section>
        <Section id="subscription-faq">
          <p className="section-eyebrow">Good to know</p>
          <h2 className="mt-6">Before you subscribe.</h2>
          <div className={styles.faq}>
            {[
              [
                "How does quarterly or annual billing work?",
                "Quarterly billing includes a 10% discount and is paid every three months upfront. Annual billing includes a 20% discount and is paid for the full year upfront. The monthly figure shown for these options is the equivalent monthly cost, not a monthly payment.",
              ],
              [
                "What is included in onboarding?",
                "Standard onboarding helps you get started with the product and its existing workflows. We confirm your setup requirements and supported integrations before you subscribe. Bespoke development and custom integrations are scoped separately.",
              ],
              [
                "Are AI and messaging usage unlimited?",
                "No unlimited usage is promised. We confirm included AI usage, team seats, and storage before subscription. Third-party WhatsApp, SMS, or other provider charges may be additional; applicable costs are explained before you proceed.",
              ],
              [
                "Can I connect my current lead sources?",
                "Tell us which forms, advertising accounts, messaging tools, and property portals you use. We confirm supported integrations and any required provider permissions during onboarding.",
              ],
              [
                "How do I subscribe?",
                "Choose your billing duration and select a plan to send us an onboarding enquiry with that selection. We confirm the plan scope, usage allowances, billing terms, and setup steps before arranging payment.",
              ],
              [
                "What if I need a CRM built around a unique process?",
                "Our custom CRM service is available separately for bespoke workflows, integrations, and development. Share your requirements and we will prepare a tailored proposal.",
              ],
              [
                "What are the renewal and cancellation terms?",
                "We provide the renewal, cancellation, and refund terms before you subscribe. Review those terms with the selected billing duration before making payment.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </Section>
        <Section id="custom-crm">
          <div className={styles.custom}>
            <div>
              <p className="section-eyebrow">For a different way of working</p>
              <h2>
                Need something
                <br />
                built around you?
              </h2>
              <p>
                Explore custom CRM development for specialised workflows and
                integrations.
              </p>
            </div>
            <ButtonLink href="/product/real-estate-crm" variant="outline">
              Discuss a custom CRM <span aria-hidden="true">↗</span>
            </ButtonLink>
          </div>
        </Section>
      </main>
      <Footer />
    </>
  );
}
