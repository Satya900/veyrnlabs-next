import { Eyebrow } from "@/components/ui/Eyebrow";

export function ImportReview({
  rows,
  busy,
  onImport,
}: {
  rows: Record<string, unknown>[];
  busy: boolean;
  onImport: () => void;
}) {
  return (
    <>
      <Eyebrow>CSV IMPORT</Eyebrow>
      <h2>Review {rows.length} leads</h2>
      <p>
        All rows were validated. Leads start in the first open stage. Existing
        contacts are not merged automatically.
      </p>
      <div className="crm-import-preview">
        {rows.slice(0, 10).map((r, i) => (
          <p key={i}>
            <strong>{String(r.name)}</strong> · {String(r.company || r.email || "Individual")}
          </p>
        ))}
        {rows.length > 10 && <p>And {rows.length - 10} more…</p>}
      </div>
      <button className="crm-primary" disabled={busy} onClick={onImport}>
        {busy ? "Importing…" : `Import ${rows.length} leads`}
      </button>
    </>
  );
}
