import type { LeadInsightSummary } from "@/lib/crm/model";

const LABEL = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;

/** The AI's hot/warm/cold read of a lead, with its one-line reason as a tooltip. */
export function ScoreBadge({ insight }: { insight?: Pick<LeadInsightSummary, "score" | "score_reason"> }) {
  if (!insight) return null;
  return (
    <span className={`crm-score ${insight.score}`} title={insight.score_reason || undefined}>
      {LABEL[insight.score]}
    </span>
  );
}
