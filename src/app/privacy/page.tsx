import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Section } from "@/components/Section";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { site, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: `Privacy Policy | ${site.name}`,
  description: "How Veyrn Labs collects, uses, and protects information through veyrnlabs.com and the Veyrn CRM product.",
  alternates: { canonical: siteUrl("/privacy") },
};

const updated = "26 September 2026";

const clauses = [
  ["Who we are, and what this policy covers", `Veyrn Labs is an AI engineering and custom software studio operated by Satyabrata Mohanty, based in Bengaluru, India. We also build and operate Veyrn CRM, a subscription product for real estate teams. This policy covers two things: the marketing site at veyrnlabs.com, and the Veyrn CRM workspace at veyrnlabs.com/crm, including Free, Pro, and Pro Plus accounts. It does not cover the separate, project-specific agreement we sign with custom software clients, which addresses data handling for that work on its own terms. If anything here is unclear, write to us at ${site.email} and we'll clarify or correct it.`],
  ["Two roles we play with your data", "For your own account details (your name, work email, business name, and billing information), we are the controller: we decide why that data is collected and how it's used, as described below. For the leads, clients, conversations, and notes your team enters into your Veyrn CRM workspace, the situation is different: that is your business's data about your own customers, and we process it only on your instructions, to provide the service. In that relationship, you (the subscribing business) are the controller or data fiduciary, and Veyrn Labs is your processor. If one of your leads wants to exercise a data right over information you hold about them, they should contact you directly; we'll support you in fulfilling that request."],
  ["Information you provide to us directly", "When you fill in the enquiry form on the marketing site, we ask for your name, a work email address, your company name, the type of service you're interested in, and a free-text description of your project. When you create a Veyrn CRM account, we ask for your name, a work email address, your business name, and a password (stored as a salted hash by our authentication provider, never in plain text). If you book a discovery call, that scheduling happens entirely on Google's own calendar page, governed by Google's privacy policy rather than this one; we only see the appointment it creates."],
  ["Information your workspace stores", "Once you're inside Veyrn CRM, your workspace stores whatever your team enters or connects: lead and client records, pipeline stages, notes, tasks, activity history, and, if you connect them, WhatsApp conversations and Google Calendar bookings for site visits. This is business data you and your team control. We store it to run the product; we don't read it for any other purpose, sell it, or use it to train a model."],
  ["How AI features process data", "Pro and Pro Plus workspaces can turn on AI-assisted replies and follow-up drafting. When you do, the relevant lead details and recent conversation are sent to our AI inference provider, Groq, solely to generate a suggested reply or draft, which a team member reviews before anything is sent. That request is not used by the provider to train its models, and we don't retain the raw request beyond what's needed to generate and log the draft. Turning this off in Settings stops any further data from being sent for that purpose."],
  ["WhatsApp and messaging data", "If you connect a WhatsApp Business number, messages you send and receive pass through Meta's WhatsApp Business Platform and are stored in your workspace so your team has conversation context. That transport layer is subject to Meta's own data policies, which we encourage you to read if you rely on WhatsApp messaging. Email follow-ups we send on your behalf are delivered via Resend, a transactional email provider, and logged in your workspace as an activity."],
  ["Payments and billing data", "Paid plans are billed through Razorpay. Razorpay collects and stores your payment method directly; we never see or store your full card or bank account number. We retain billing metadata on our side, such as your plan, billing period, and payment status, for accounting and support purposes."],
  ["Cookies and session data", "The public marketing site sets no cookies of its own and runs no analytics, advertising pixels, or tracking script. Veyrn CRM sets one cookie: a host-only, HTTP-only session cookie, created only after you sign in, used solely to keep you authenticated in your workspace. It is never set for a visitor to the public marketing pages."],
  ["Who we share data with", "We don't sell, rent, or trade personal data. We share it only with the infrastructure and service providers needed to run Veyrn CRM, each bound by their own security and data-processing terms: Supabase (database and authentication), Resend (transactional email), Groq (AI inference for draft replies), Meta Platforms (WhatsApp Business Platform), Razorpay (payments), Google (Calendar integration, only for workspaces that connect it), and Vercel (hosting). We would disclose information if legally required to, for example by a valid court order, though it isn't something we do routinely."],
  ["How long we keep it", "We retain your account and workspace data for as long as your account is active, plus a reasonable period afterward in case you want to reactivate or export it. If you close your account, we delete workspace data within a reasonable period unless we're required to keep specific records (such as billing history) for longer under applicable law. Marketing-site enquiries are kept for as long as they're relevant to the conversation they came from, or as long as business-record rules require."],
  ["Your rights", `You can ask us at any time to show you the personal data we hold about your own account, correct it if it's wrong, or delete it, by emailing ${site.email}. We act on that within a reasonable time and confirm once it's done. If you're one of our subscribers' leads or clients and want to exercise a right over data held about you in their workspace, please contact that business directly, since they control that data; we'll assist them as their processor.`],
  ["Security", "We take reasonable technical steps to protect what you share with us: database access is scoped by row-level security rather than a single shared key, credentials capable of bypassing that security are kept server-side and never exposed to a browser, OAuth and calendar tokens are encrypted at rest, requests to our public endpoints are checked for origin and rate-limited to slow down abuse, and the site is served exclusively over HTTPS. That said, no method of transmission or storage is completely secure, and we can't promise absolute protection."],
  ["Children's privacy", "This site and Veyrn CRM are intended for businesses and professional contacts, not children. We don't knowingly collect personal data from anyone under 18, and if we learn that we have, we'll delete it."],
  ["Governing law", "This policy, and any question about how we handle your data, is governed by the laws of India, including the Digital Personal Data Protection Act, 2023 where it applies to our processing of personal data."],
  ["Changes to this policy", "We may update this policy as the site, our product, or our practices change. When we do, we update the date at the top of this page, and if a change is significant we'll make that clear here rather than relying on you to notice a quiet edit."],
];

export default function PrivacyPage() {
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <Nav />
      <main id="main">
        <div className="hero-shell">
          <div className="legal-hero-intro">
            <Eyebrow>Legal</Eyebrow>
            <h1>Privacy Policy</h1>
            <p>What we collect through veyrnlabs.com and Veyrn CRM, why, and how you can ask us about it.</p>
            <p className="legal-meta">Last updated {updated}</p>
          </div>
        </div>
        <Section id="privacy-detail">
          <div className="quality-checks">
            {clauses.map(([title, body], i) => (
              <article key={title}>
                <span className="quality-check-number">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </article>
            ))}
          </div>
        </Section>
      </main>
      <Footer />
    </>
  );
}
