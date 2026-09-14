import { money } from "@/lib/crm/model";
import type { metrics } from "@/lib/crm/model";

export function StatsRow({ summary }: { summary: ReturnType<typeof metrics> }) {
  const stats = [
    {
      label: "New leads",
      value: summary.newLeads,
      note: "Created in selected period",
      icon: "↗",
    },
    {
      label: "Open pipeline",
      value: money(summary.pipeline),
      note: "All current open opportunities",
      icon: "◫",
    },
    {
      label: "Won deal value",
      value: money(summary.wonValue),
      note: `${summary.won} deals won in selected period`,
      icon: "◎",
    },
    {
      label: "Win rate",
      value: summary.rate === null ? "—" : `${summary.rate}%`,
      note: "Won ÷ closed deals in period",
      icon: "↗",
    },
  ];
  return (
    <div className="crm-stats">
      {stats.map((s, i) => (
        <article className={`crm-stat stat-${i}`} key={s.label}>
          <div>
            <span>{s.label}</span>
            <span className="stat-icon">{s.icon}</span>
          </div>
          <strong>{s.value}</strong>
          <small>{s.note}</small>
        </article>
      ))}
    </div>
  );
}
