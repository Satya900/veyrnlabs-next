import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Section } from "@/components/Section";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { site, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: `Privacy Policy | ${site.name}`,
  description: "How Veyrn Labs collects, uses, and protects the information you share through veyrnlabs.com.",
  alternates: { canonical: siteUrl("/privacy") },
};

const updated = "20 September 2026";

const clauses = [
  ["Who we are", `Veyrn Labs is an AI engineering and custom software studio operated by Satyabrata Mohanty, based in Bengaluru, India. We build AI agents, custom business platforms, and workflow automation for clients, and we operate an internal CRM to manage those relationships. This policy explains what personal data we collect through veyrnlabs.com, why we collect it, how long we keep it, and how you can ask us about it. It doesn't cover the password-protected CRM workspace used by our own team, which is documented separately for the people who administer it. If anything here is unclear, write to us at ${site.email} and we'll clarify or correct it.`],
  ["Information you provide to us", "When you fill in the enquiry form on this site, we ask for your name, a work email address, your company name, the type of service you're interested in, and a free-text description of your project. Only your name and project details are required; everything else is optional context that helps us respond appropriately. If you email us directly instead, we receive whatever you choose to include in that email and any attachments. If you book a discovery call, that scheduling happens entirely on Google's own calendar page, governed by Google's own privacy policy rather than this one. We only see the appointment it creates."],
  ["How we use your information", "We use what you send us for one purpose: to understand your enquiry, judge whether we're a good fit, and reply to you. If a project follows, that same information becomes the starting point for managing the engagement inside our CRM, alongside a separate agreement between us. We don't use your information to send marketing you haven't asked for, we don't build advertising profiles from it, and we don't use it to train any model."],
  ["How and where it's stored", "Enquiries are written directly to a Supabase-hosted PostgreSQL database as soon as you submit the form. That table is protected by row-level security, so only workspace members authorized to see leads can read it, and the write path runs through a database function rather than exposing broad access. If email notification is turned on, a short summary of a new enquiry (name, email, company, service, and your notes) is also sent once, via Resend, a transactional email provider, to our own inbox so we notice it promptly. That's the only copy of your data that leaves the database, and it goes to us, not to a marketing platform."],
  ["Cookies and tracking", "The public marketing site sets no cookies of its own and runs no analytics, advertising pixels, or other tracking script. We don't collect behavioral data about visitors here. The only cookie in this codebase is a host-only, HTTP-only session cookie used inside the password-protected CRM workspace, and it's set only after a team member signs in there; it is never set for a visitor to the public pages you're reading now."],
  ["Sharing with third parties", "We don't sell, rent, or trade your personal data. It's shared only with the infrastructure providers we use to run the site and store the data: Supabase for hosting the database and Resend for delivering the one notification email described above, each acting under their own security and data-processing terms. We would disclose information if legally required to, for example by a valid court order, though we haven't had cause to and it isn't something we do routinely."],
  ["How long we keep it", "We retain enquiry data for as long as it's relevant to the relationship it came from (while we're actively discussing a project and for a reasonable period afterward for our own records), or for as long as the law requires us to keep business records. Once neither applies, or if you ask us to delete it, we remove it."],
  ["Your rights", `You can ask us at any time to show you the personal data we hold about you, correct it if it's wrong, or delete it outright, by emailing ${site.email}. We act on that within a reasonable time and confirm once it's done. If your enquiry has already become a live client engagement, deleting the underlying business record may be limited by legitimate recordkeeping needs, which we'll explain if it applies.`],
  ["Security", "We take reasonable technical steps to protect what you share with us: database access is scoped by row-level security rather than a single shared key, credentials capable of bypassing that security are kept server-side and never exposed to a browser, requests to our public enquiry endpoint are checked for origin and rate-limited to slow down abuse, and the site is served exclusively over HTTPS. That said, no method of transmission or storage is completely secure, and we can't promise absolute protection."],
  ["Children's privacy", "This site and the services it describes are intended for businesses and professional contacts, not children. We don't knowingly collect personal data from anyone under 18, and if we learn that we have, we'll delete it."],
  ["Governing law", "This policy, and any question about how we handle your data, is governed by the laws of India."],
  ["Changes to this policy", "We may update this policy as the site, our tools, or our practices change. When we do, we update the date at the top of this page, and if a change is significant we'll make that clear here rather than relying on you to notice a quiet edit."],
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
            <p>What we collect through veyrnlabs.com, why, and how you can ask us about it.</p>
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
