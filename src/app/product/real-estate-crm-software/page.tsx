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
            One workspace for your property leads, AI-drafted follow-ups, and
            your team’s next action. Give your team the context to move each
            opportunity forward, even when a lead goes quiet after hours.
          </p>
          <div className={styles.actions}>
            <ButtonLink href="#pricing" variant="primary">
              Find your plan <span aria-hidden="true">↓</span>
            </ButtonLink>
            <Link href="/product/real-estate-crm">Need a custom CRM? ↗</Link>
          </div>
          <div className={styles.strip}>
            <span>AI-drafted follow-ups</span>
            <span>Organised pipeline</span>
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
          <p className="section-eyebrow">From first enquiry to follow-up</p>
          <h2 className="mt-6">Nothing sits untouched.</h2>
          <div className={styles.workflow}>
            {[
              [
                "01",
                "Bring leads together",
                "Add enquiries manually or import them by CSV, and keep contact details and conversation history with each one.",
              ],
              [
                "02",
                "Let AI draft the follow-up",
                "When a lead goes quiet, an AI-drafted email goes out automatically, written from your own company and property information.",
              ],
              [
                "03",
                "Give every lead a next action",
                "Use reminders and site-visit scheduling to help your agents stay organised.",
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
                "Standard onboarding helps you get started with the product: setting up your pipeline, adding your team, and importing your existing leads by CSV. Bespoke development and custom integrations are scoped separately, as their own project.",
              ],
              [
                "Are AI and messaging usage unlimited?",
                "No. Pro and Pro Plus each include a defined AI and messaging allowance per billing period, shown in your workspace before you subscribe. Allowances reset each period and never trigger automatic overage charges.",
              ],
              [
                "How do leads get into Veyrn CRM?",
                "Add them manually or import a CSV of your existing leads. WhatsApp enquiries can create leads automatically once your number is connected and approved. A direct connection to a specific ad platform or portal isn't available yet; tell us what you use and we'll confirm what's possible.",
              ],
              [
                "How do I subscribe?",
                "Create a free account, then choose Pro or Pro Plus and a billing duration from Settings. That opens secure checkout with Razorpay, and billing starts immediately once payment goes through.",
              ],
              [
                "What if I need a CRM built around a unique process?",
                "Our custom CRM service is available separately for bespoke workflows, integrations, and development. Share your requirements and we will prepare a tailored proposal.",
              ],
              [
                "What are the renewal and cancellation terms?",
                "Paid plans renew automatically at the end of each billing period. Cancel any time from Settings and keep access until the period ends. Full renewal, cancellation, and refund terms are in our Terms & Conditions.",
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
