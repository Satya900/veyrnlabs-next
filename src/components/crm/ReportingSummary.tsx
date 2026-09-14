"use client";
import { metrics } from "@/lib/crm/model";
import { DateRangeControls } from "./DateRangeControls";
import { StatsRow } from "./StatsRow";
import { useWorkspaceContext } from "./context";

export function ReportingSummary({
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
  const { data } = useWorkspaceContext();
  return (
    <>
      <div className="crm-section-heading">
        <span className="crm-muted">Reporting period · UTC</span>
        <DateRangeControls from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      <StatsRow summary={metrics(data, from, to)} />
    </>
  );
}
