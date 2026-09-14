export function DateRangeControls({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
}) {
  return (
    <div className="crm-dates">
      <label>
        From
        <input
          aria-label="Report start date"
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <span>—</span>
      <label>
        To
        <input
          aria-label="Report end date"
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
    </div>
  );
}
