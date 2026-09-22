import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Section } from "@/components/Section";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { site, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: `Terms & Conditions | ${site.name}`,
  description: "The terms that govern your use of veyrnlabs.com.",
  alternates: { canonical: siteUrl("/terms") },
};

const updated = "20 September 2026";

const clauses = [
  ["Acceptance of these terms", "By visiting or using veyrnlabs.com in any way, you agree to be bound by these terms and conditions. They apply to every page of the site, including the enquiry form and any linked booking pages we control. If you don't agree with them, the only appropriate step is to stop using the site."],
  ["What this website is, and isn't", "This site exists to describe Veyrn Labs' AI engineering, custom software, and workflow automation work, including a set of illustrative case studies drawn from delivered projects. Nothing on it is a quote, a proposal, or a binding offer to perform work for you. Prices, timelines, and scope for an actual project are only ever set out in a separate, explicitly agreed document between us. This website is informational, not contractual."],
  ["Enquiries and discovery calls don't create an engagement", "Filling in the enquiry form, emailing us, or booking a discovery call through the linked scheduler does not, by itself, create a client relationship, a contract, or any obligation on either side to proceed. It simply starts a conversation. If we decide to work together, the resulting engagement is governed by its own signed proposal or agreement, and wherever that document says something different from this page, the signed agreement controls."],
  ["Case studies and results", "The case studies on this site describe systems we've actually built and delivered, but we describe them in generalized terms, without naming the client or exposing anything confidential, to honor the confidentiality every engagement is entitled to. They illustrate our approach and the kind of outcome it can produce; they are not a guarantee that a comparable result, timeline, or cost will be reproduced for your project, which will have its own constraints and requirements."],
  ["Intellectual property", "Unless we say otherwise, the text, layout, design, and Veyrn Labs branding on this site belong to us. You're welcome to read it, link to it, and reference it for your own personal or evaluative use; you may not copy the design, wholesale content, or branding to build another commercial site. None of this affects intellectual property in work we deliver to clients, which is addressed separately and specifically in each project's own agreement."],
  ["No warranty", "This website and everything on it, including the case studies, the FAQ, and any general description of our approach, is provided \"as is,\" without a warranty that it's accurate, complete, or up to date at the moment you read it, to the extent the law allows us to say so. We do our best to keep it current, but we don't warrant that it will meet a particular purpose you have in mind for it."],
  ["Limitation of liability", "To the extent permitted by law, Veyrn Labs is not liable for indirect, incidental, or consequential loss arising from your use of, or inability to use, this website. Nothing in these terms attempts to limit liability that cannot lawfully be limited or excluded, such as liability for fraud."],
  ["Links to other services", "Where this site links to a third-party service (the Google-hosted discovery-call scheduler, or a mailto link that opens your own email client), that service is operated independently of us and governed by its own terms and privacy practices, which we encourage you to read before using it."],
  ["Governing law and jurisdiction", "These terms are governed by the laws of India. Any dispute arising out of or relating to your use of this website is subject to the exclusive jurisdiction of the courts of Bengaluru, Karnataka."],
  ["Changes to these terms", "We may revise these terms as the site, our services, or applicable law changes. Continuing to use the site after a revision means you accept the updated terms; the date at the top of this page always reflects the version currently in force."],
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
            <p>The terms that govern your use of this website. Project engagements are governed separately, by their own signed agreement.</p>
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
