import { Section } from "./Section";
import { Eyebrow } from "./ui/Eyebrow";
import { ButtonLink } from "./ui/Button";
import { site } from "@/lib/site";
import { EnquiryForm } from "./EnquiryForm";

export function Contact() {
  return (
    <Section id="contact">
      <div className="contact-options">
        <Eyebrow>Get in touch</Eyebrow>
        <h2 className="mt-6">Let&apos;s talk about your project.</h2>
        <p className="prose-measure mt-6 text-body">
          Tell us what you want to build. Send an email or book a discovery
          call to explore how we can help.
        </p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-4 sm:flex-row">
          <ButtonLink href={`mailto:${site.email}`} variant="outline">
            Email Satyabrata <span aria-hidden="true">↗</span>
          </ButtonLink>
          <ButtonLink href={site.discoveryCallUrl} variant="primary">
            Book a discovery call <span aria-hidden="true">↗</span>
          </ButtonLink>
        </div>
        <p className="mt-5 text-sm text-mute">{site.email}</p>
        {process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && <EnquiryForm />}
      </div>
    </Section>
  );
}
