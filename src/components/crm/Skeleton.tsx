// Placeholder rows for panels waiting on data. Widths vary so the shape reads as content,
// not as a progress bar; the label is what assistive technology announces.
const WIDTHS = ["92%", "68%", "80%", "56%", "74%"];

export function SkeletonRows({
  rows = 3,
  label,
  variant = "line",
  className = "",
}: {
  rows?: number;
  label: string;
  variant?: "line" | "card";
  className?: string;
}) {
  return (
    <div className={`crm-skeleton-rows ${className}`} role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) =>
        variant === "card" ? (
          <div className="crm-skeleton-item" key={i} aria-hidden="true">
            <div className="crm-skeleton-line" style={{ width: "45%" }} />
            <div className="crm-skeleton-line" style={{ width: WIDTHS[i % WIDTHS.length] }} />
          </div>
        ) : (
          <div
            className="crm-skeleton-line"
            key={i}
            aria-hidden="true"
            style={{ width: WIDTHS[i % WIDTHS.length] }}
          />
        ),
      )}
    </div>
  );
}
