"use client";
import { dateLabel, dueFollowUps, attentionItems, overdueTasks } from "@/lib/crm/workspace";
import { useWorkspaceContext } from "../context";
import { LeadTable } from "../LeadTable";

export function Overview() {
  const { data, stages, now, changeView, setSelected } = useWorkspaceContext();
  const overdue = overdueTasks(data.tasks, now);
  const dueLeads = dueFollowUps(data.leads, stages, now);
  const attention = attentionItems(overdue, dueLeads, data.leads).slice(0, 4);
  const openStages = stages.filter((s) => s.kind === "open");
  const maxCount = Math.max(
    1,
    ...stages.map((stage) => data.leads.filter((l) => l.stage_id === stage.id).length),
  );
  return (
    <>
      <div className="crm-overview-grid">
        <section className="crm-panel">
          <div className="crm-panel-heading">
            <div>
              <h2>Your pipeline</h2>
              <p>From first hello to a signed deal.</p>
            </div>
            <button onClick={() => changeView("Leads")}>View pipeline ↗</button>
          </div>
          <div className="crm-pipeline-chart">
            {openStages.map((s, i) => {
              const count = data.leads.filter((l) => l.stage_id === s.id).length;
              return (
                <div className="chart-column" key={s.id}>
                  <span>{count}</span>
                  <div className="chart-bar-space">
                    <div
                      className={`chart-bar bar-${i % 4}`}
                      style={{ height: `${Math.max(3, (count / maxCount) * 100)}%` }}
                    />
                  </div>
                  <small>{s.name}</small>
                </div>
              );
            })}
          </div>
          <div className="crm-chart-footer">
            <span>
              <i /> Open opportunities
            </span>
            <strong>
              {data.leads.filter((l) => stages.find((s) => s.id === l.stage_id)?.kind === "open").length}{" "}
              leads in motion
            </strong>
          </div>
        </section>
        <section className="crm-panel">
          <div className="crm-panel-heading">
            <div>
              <h2>
                Needs your attention{" "}
                <span className="crm-count">{overdue.length + dueLeads.length}</span>
              </h2>
              <p>The next steps that matter.</p>
            </div>
          </div>
          <div className="crm-attention">
            {attention.map((t) => (
              <button key={t.id} onClick={() => setSelected(t.lead)}>
                <span className="attention-icon">↗</span>
                <span>
                  <strong>{t.title}</strong>
                  <small>
                    {data.leads.find((l) => l.id === t.lead)?.company || "Lead follow-up"}
                  </small>
                </span>
                <em>{dateLabel(t.due)}</em>
              </button>
            ))}
            {!overdue.length && !dueLeads.length && (
              <div className="crm-empty">
                <h3>You’re all caught up.</h3>
                <p>Your overdue tasks and lead follow-ups will appear here.</p>
              </div>
            )}
          </div>
          <button className="crm-panel-footer" onClick={() => changeView("Follow-ups")}>
            View all follow-ups →
          </button>
        </section>
      </div>
      <section className="crm-panel">
        <div className="crm-panel-heading">
          <div>
            <h2>Recent opportunities</h2>
            <p>A new connection. A new possibility.</p>
          </div>
          <button onClick={() => changeView("Leads")}>All leads ↗</button>
        </div>
        <LeadTable
          rows={[...data.leads].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5)}
          stages={stages}
          members={data.members}
          now={now}
          onSelect={setSelected}
        />
      </section>
    </>
  );
}
