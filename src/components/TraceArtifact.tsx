import { LogoMark } from "./Logo";

const events = [
  { label: "Intent received", detail: "Send pricing to a new lead", state: "01" },
  { label: "Policy validation", detail: "Consent required before delivery", state: "02" },
  { label: "Action verified", detail: "Verified lead · policy check passed", state: "✓" },
];

export function TraceArtifact() {
  return (
    <div className="system-scene">
      <div className="scene-caption"><span>THE VERIFICATION LAYER</span><span>FIG. 01 / SYSTEM VIEW</span></div>
      <div className="system-orbit" aria-hidden="true"><div /><span className="orbit-logo"><LogoMark /></span></div>
      <div className="trace-panel">
        <div className="trace-heading"><span><span className="status-dot" /> Workflow trace</span><span className="trace-badge">ILLUSTRATIVE</span></div>
        <div className="trace-events">
          {events.map((event, index) => <div key={event.label} className={`trace-event animate-trace-in ${index === 2 ? "is-verified" : ""}`} style={{ animationDelay: `${index * 160}ms` }}><span className="event-number">{event.state}</span><div><p>{event.label}</p><span>{event.detail}</span></div><span className="event-check" aria-hidden="true">{index === 2 ? "↗" : "✓"}</span></div>)}
        </div>
        <div className="trace-footer"><span>PROPOSE → VALIDATE → EXECUTE</span><span className="text-primary">Verified ✓</span></div>
      </div>
      <p className="scene-note">Intelligence moves things forward.<br />Verification keeps them on track.</p>
    </div>
  );
}
