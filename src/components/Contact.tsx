import { Section } from "./Section";
import { Eyebrow } from "./ui/Eyebrow";
import { ButtonLink } from "./ui/Button";

export function Contact() {
  return (
    <Section id="contact">
      <div className="contact-progress">
        <Eyebrow>Get in touch</Eyebrow>
        <h2 className="mt-6">Let&apos;s talk about your project.</h2>
        <div className="work-in-progress">
          <span className="progress-rule" aria-hidden="true" />
          <p><span aria-hidden="true">×</span> System work in progress</p>
          <span className="progress-rule" aria-hidden="true" />
        </div>
        <p className="prose-measure text-body">
          Our contact system is currently being updated. For now, contact us
          directly by sending an email.
        </p>
        <ButtonLink
          className="mt-7"
          href="mailto:hello@veyrnlabs.com?subject=Project%20inquiry%20for%20Veyrn%20Labs"
          variant="primary"
        >
          hello@veyrnlabs.com <span aria-hidden="true">↗</span>
        </ButtonLink>
      </div>
    </Section>
  );
}
