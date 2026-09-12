import { Section } from "./Section";
import { Eyebrow } from "./ui/Eyebrow";

export function Problem() {
  return (
    <Section className="editorial-section">
      <Eyebrow>The problem</Eyebrow>
      <h2 className="mt-4 font-sans text-3xl tracking-[-0.025em] text-ink md:text-[2.75rem] md:leading-[1.05]">
        We exist for the gap software didn&apos;t close
      </h2>
      <div className="prose-measure mt-6 space-y-5 text-lg leading-relaxed text-body">
        <p>
          Most businesses already have software. The gap isn&apos;t a missing
          tool, it&apos;s that important work still runs through manual
          steps, scattered systems, and people moving information by hand
          between them.
        </p>
        <p>
          We build the missing system around the workflow that&apos;s already
          there, and we build it to survive contact with real customers, not
          just a demo audience. That means the eval suite that fails when
          something actually breaks, the validation layer that checks an
          AI&apos;s proposed action before it executes, and the audit trail
          that shows what happened and why.
        </p>
      </div>
    </Section>
  );
}

