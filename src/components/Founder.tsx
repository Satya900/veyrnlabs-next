import { Section } from "./Section";
import { Eyebrow } from "./ui/Eyebrow";

export function Founder() {
  return (
    <Section id="studio">
      <div className="founder-layout">
        <div className="founder-monogram" aria-hidden="true"><span>SM</span><p>ENGINEERING-LED.<br />PERSONALLY ACCOUNTABLE.</p><span className="monogram-cross">+</span></div>
        <div><Eyebrow>The studio</Eyebrow><h2 className="mt-5">Work directly with<br />the person building it.</h2><p className="founder-name">Satyabrata Mohanty <span>Founder & engineer</span></p><p className="prose-measure text-body">Veyrn Labs brings product development and AI engineering together under direct founder ownership. Satyabrata has built and delivered the systems featured here, from the initial workflow to the application and integrations behind it.</p><div className="founder-credentials"><div><strong>BugLens</strong><span>AI code review product used by paying customers</span></div><div><strong>30+ articles</strong><span>Technical writing on GeeksforGeeks</span></div><div><strong>IIT Madras</strong><span>Studying data science</span></div></div></div>
      </div>
    </Section>
  );
}
