import { money } from "@/lib/crm/model";
import type { Lead, Member, Stage } from "@/lib/crm/model";
import { datetime, initials, isOverdueFollowUp, stageOf } from "@/lib/crm/workspace";

export function LeadTable({
  rows,
  stages,
  members,
  now,
  onSelect,
}: {
  rows: Lead[];
  stages: Stage[];
  members: Member[];
  now: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="crm-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Contact / company</th>
            <th>Stage</th>
            <th>Deal value</th>
            <th>Source</th>
            <th>Next follow-up</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>
                <button className="crm-contact" onClick={() => onSelect(l.id)}>
                  <span className="crm-avatar">{initials(l.name)}</span>
                  <span>
                    <strong>{l.name}</strong>
                    <small>{l.company || l.email || "Individual"}</small>
                  </span>
                </button>
              </td>
              <td>
                <span className={`crm-badge ${stageOf(stages, l)?.kind}`}>
                  {stageOf(stages, l)?.name}
                </span>
              </td>
              <td>{money(l.value)}</td>
              <td>{l.source || "Manual"}</td>
              <td className={isOverdueFollowUp(l, stages, now) ? "crm-overdue" : ""}>
                {l.follow_up ? datetime(l.follow_up) : "Not scheduled"}
              </td>
              <td>
                {members.find((m) => m.id === l.owner_id)?.name || "Unassigned"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="crm-empty">
          <h3>No leads here yet</h3>
          <p>Add a lead or adjust your filters to get started.</p>
        </div>
      )}
    </div>
  );
}
