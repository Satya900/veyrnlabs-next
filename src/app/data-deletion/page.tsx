import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Section } from "@/components/Section";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { site, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: `Data Deletion | ${site.name}`,
  description: "How to delete your Veyrn CRM data, disconnect WhatsApp, and remove the Veyrn CRM app from your Facebook account.",
  alternates: { canonical: siteUrl("/data-deletion") },
};

const updated = "3 November 2026";

// Meta's app settings link here as the "User data deletion instructions" URL.
const clauses = [
  ["What this page covers", `These are the steps to delete data held by Veyrn CRM, including data received through Facebook Login for Business and the WhatsApp Business Platform. How we handle data generally is described in our Privacy Policy at ${siteUrl("/privacy")}.`],
  ["Disconnect WhatsApp from your workspace", "A workspace owner can open Veyrn CRM, go to Settings, then WhatsApp, and choose Disconnect. This immediately deletes the stored WhatsApp access token for your business and stops new messages from being received or sent through Veyrn CRM. Conversations already in your workspace stay there until you delete them or ask us to delete your workspace."],
  ["Remove the Veyrn CRM app from Facebook", "In Facebook, open Settings and privacy, then Settings, then Business integrations. Find Veyrn CRM and choose Remove. In Meta Business Suite you can also remove our access to your WhatsApp Business account under Settings, then Integrations, then Connected apps. Removing the app revokes our access at Meta; it doesn't by itself erase data already stored in your workspace."],
  ["Ask us to delete your data", `Email ${site.email} from your account's email address with the subject "Data deletion request". Tell us your business name and whether you want your whole workspace deleted or only specific data, such as WhatsApp conversations. We confirm the request by email, then delete the workspace data, including leads, conversations, messages and stored tokens, within 30 days, and email you once it's done.`],
  ["What we may keep", "We keep billing and tax records, such as invoices and payment status, for as long as Indian law requires. We hold no card or bank details; Razorpay stores those. Deleted data may stay in encrypted backups for a short period until those backups expire."],
  ["If you're a customer of a business using Veyrn CRM", "If you messaged a business that uses Veyrn CRM, that business controls your data. Ask them to delete it; we will carry out their instructions as their processor. If you can't reach them, email us and we'll pass your request on."],
];

export default function DataDeletionPage() {
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <Nav />
      <main id="main">
        <div className="hero-shell">
          <div className="legal-hero-intro">
            <Eyebrow>Legal</Eyebrow>
            <h1>Data Deletion</h1>
            <p>How to remove your data from Veyrn CRM and revoke access to your Facebook and WhatsApp accounts.</p>
            <p className="legal-meta">Last updated {updated}</p>
          </div>
        </div>
        <Section id="data-deletion-detail">
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
