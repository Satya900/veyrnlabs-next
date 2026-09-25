import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Section } from "@/components/Section";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { site, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: `Terms & Conditions | ${site.name}`,
  description: "The terms that govern your use of veyrnlabs.com and the Veyrn CRM product.",
  alternates: { canonical: siteUrl("/terms") },
};

const updated = "26 September 2026";

const clauses = [
  ["Acceptance of these terms", "By visiting veyrnlabs.com, or creating and using a Veyrn CRM account, you agree to be bound by these terms. They apply to the marketing site and to the Veyrn CRM product itself, at every plan level. If you don't agree with them, the only appropriate step is to stop using the site and the product."],
  ["The marketing site is informational, not contractual", "The marketing pages describe Veyrn Labs' AI engineering, custom software, and workflow automation work, including illustrative case studies. Nothing on those pages is a quote, a proposal, or a binding offer to perform custom work for you. Filling in the enquiry form, emailing us, or booking a discovery call does not, by itself, create a client relationship or any obligation on either side. If we agree to a custom project, that engagement is governed by its own separate, signed agreement, which controls wherever it differs from this page."],
  ["Veyrn CRM accounts", "To use Veyrn CRM you must create an account with accurate information and be authorized to act for the business you're signing up. You're responsible for keeping your credentials confidential and for activity under your account, including anything done by teammates you invite. We may limit the number of team members based on your plan, as described on the pricing page."],
  ["Plans, billing, and renewal", "Veyrn CRM offers a Free plan and paid Pro and Pro Plus plans, billed monthly, quarterly, or annually in advance through Razorpay. Paid plans renew automatically at the end of each billing period unless you cancel before it renews. We may change plan pricing or included allowances going forward; we'll give you reasonable notice before a change takes effect on your account, and continuing to use a paid plan after that notice means you accept the new price."],
  ["Cancellation and refunds", "You can cancel a paid plan at any time from Settings; cancellation takes effect at the end of your current billing period, and you keep access until then. Amounts already paid for the current period are non-refundable except where required by law, or where we decide otherwise at our discretion for a specific case. Downgrading to Free at the end of a paid period keeps your lead and client data, but disables AI, messaging automation, and scheduling features until you resubscribe."],
  ["Acceptable use", "You agree to use Veyrn CRM lawfully: you must have a proper basis to contact the leads and clients you add, and your use of WhatsApp and email messaging features must comply with applicable law (including India's data protection and telecom-marketing rules) and with WhatsApp's own Business Messaging Policy. You may not use the product to send unsolicited bulk messages, to store data you're not entitled to hold, to attempt to bypass plan limits or security controls, or to reverse-engineer the service."],
  ["AI-assisted features", "AI-drafted replies and follow-ups are suggestions generated automatically from your workspace data; they may be inaccurate or unsuitable for a given conversation. Where AI drafts require review before sending, that review is your responsibility, and you remain responsible for what your team ultimately sends to a lead or client, whether AI-assisted or not."],
  ["Your data", "You own the lead, client, and conversation data your team enters into your workspace. We process it only to provide the service, as described in our Privacy Policy, and we don't use it to train AI models or share it with anyone outside the service providers listed there. If you cancel or your account is terminated, we handle your data as described in that policy's retention section."],
  ["Third-party dependencies", "Veyrn CRM's WhatsApp messaging, calendar scheduling, AI drafting, and payment features depend on Meta's WhatsApp Business Platform, Google Calendar, our AI inference provider, and Razorpay respectively. Each is operated independently of us, and we're not responsible for their outages, policy changes, or unavailability, though we'll do what we reasonably can to keep the product working around them."],
  ["Suspension and termination", "We may suspend or terminate an account that breaches these terms, misuses the product, or has payment that fails and isn't resolved within a reasonable period after we notify you. You may stop using the product and close your account at any time."],
  ["Intellectual property", "Unless we say otherwise, the text, layout, design, and Veyrn Labs branding on the marketing site and inside Veyrn CRM belong to us. You're welcome to reference the marketing site for your own evaluative use; you may not copy its design or branding, or the Veyrn CRM product itself, to build another commercial service."],
  ["No warranty", "Veyrn CRM and the marketing site are provided \"as is,\" without a warranty that they are uninterrupted, error-free, or fit for a particular purpose, to the extent the law allows us to say so. We work to keep the service reliable and the site accurate, but we don't guarantee a specific level of uptime unless we've agreed to one separately in writing."],
  ["Limitation of liability", "To the extent permitted by law, Veyrn Labs is not liable for indirect, incidental, or consequential loss arising from your use of, or inability to use, the marketing site or Veyrn CRM, and our aggregate liability for any claim relating to Veyrn CRM is limited to the amount you paid us for the service in the three months before the claim arose. Nothing in these terms attempts to limit liability that cannot lawfully be limited or excluded, such as liability for fraud."],
  ["Governing law and jurisdiction", "These terms are governed by the laws of India. Any dispute arising out of or relating to your use of the marketing site or Veyrn CRM is subject to the exclusive jurisdiction of the courts of Bengaluru, Karnataka."],
  ["Changes to these terms", "We may revise these terms as the site, the product, or applicable law changes. Continuing to use the site or your Veyrn CRM account after a revision means you accept the updated terms; the date at the top of this page always reflects the version currently in force."],
];

export default function TermsPage() {
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <Nav />
      <main id="main">
        <div className="hero-shell">
          <div className="legal-hero-intro">
            <Eyebrow>Legal</Eyebrow>
            <h1>Terms &amp; Conditions</h1>
            <p>The terms that govern your use of this website and the Veyrn CRM product. Custom project engagements are governed separately, by their own signed agreement.</p>
            <p className="legal-meta">Last updated {updated}</p>
          </div>
        </div>
        <Section id="terms-detail">
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
