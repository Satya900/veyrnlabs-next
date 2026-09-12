import { TraceArtifact } from "./TraceArtifact";
import { ButtonLink } from "./ui/Button";

export function Hero() {
  return (
    <section id="top" className="hero-shell">
      <div className="hero-grid">
        <div>
          <p className="eyebrow"><span className="status-dot" /> AI engineering & software studio</p>
          <h1>AI that works.<br />Software that<br /><span>moves business.</span></h1>
          <p className="hero-description">We design and build AI agents, custom platforms, and connected workflows for real business operations. Engineered end to end. Verified before it ships.</p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <ButtonLink href="#contact" variant="primary">Let&apos;s build your system <span aria-hidden="true">↗</span></ButtonLink>
            <ButtonLink href="#work">Explore our work <span aria-hidden="true">↓</span></ButtonLink>
          </div>
          <p className="hero-note">Direct founder involvement. From the first conversation to delivery.</p>
        </div>
        <TraceArtifact />
      </div>
      <div className="proof-strip">
        <div><strong>02</strong><span>Systems delivered<br />and still running</span></div>
        <div><span className="proof-symbol" aria-hidden="true">⌘</span><span>AI + applications + integrations<br />One connected engineering discipline</span></div>
        <div><span className="proof-symbol" aria-hidden="true">↗</span><span>Built to be trusted.<br />Designed to keep working.</span></div>
      </div>
    </section>
  );
}

