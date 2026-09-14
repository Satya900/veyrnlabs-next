"use client";
import { datetime, initials, stageOf } from "@/lib/crm/workspace";
import { useWorkspaceContext } from "../context";

export function FollowUps() {
  const { data, stages, now, busy, mutate, setSelected } = useWorkspaceContext();
  const openFollowUps = data.leads
    .filter((l) => l.follow_up && stageOf(stages, l)?.kind === "open")
    .sort((a, b) => a.follow_up!.localeCompare(b.follow_up!));
  const sortedTasks = [...data.tasks].sort(
    (a, b) => Number(a.completed) - Number(b.completed) || a.due_at.localeCompare(b.due_at),
  );
  return (
    <div className="crm-overview-grid">
      <section className="crm-panel">
        <div className="crm-panel-heading">
          <div>
            <h2>Lead follow-ups</h2>
            <p>Open leads with a scheduled next step.</p>
          </div>
        </div>
        {openFollowUps.map((l) => (
          <button className="crm-follow-row" key={l.id} onClick={() => setSelected(l.id)}>
            <span className="crm-avatar">{initials(l.name)}</span>
            <span>
              <strong>{l.name}</strong>
              <small>{l.company}</small>
            </span>
            <span className={Date.parse(l.follow_up!) < now ? "crm-overdue" : ""}>
              {datetime(l.follow_up!)}
            </span>
          </button>
        ))}
        {!openFollowUps.length && (
          <div className="crm-empty">Schedule a follow-up from any lead.</div>
        )}
      </section>
      <section className="crm-panel">
        <div className="crm-panel-heading">
          <div>
            <h2>Tasks</h2>
            <p>Check off a next step when it’s done.</p>
          </div>
        </div>
        {sortedTasks.map((t) => (
          <div className="crm-task-row" key={t.id}>
            <input
              type="checkbox"
              aria-label={`Complete ${t.title}`}
              checked={t.completed}
              disabled={busy}
              onChange={(e) =>
                void mutate({ action: "completeTask", id: t.id, completed: e.target.checked })
              }
            />
            <button onClick={() => setSelected(t.lead_id)}>
              <strong style={{ textDecoration: t.completed ? "line-through" : "none" }}>
                {t.title}
              </strong>
              <small className={!t.completed && Date.parse(t.due_at) < now ? "crm-overdue" : ""}>
                {datetime(t.due_at)} · {data.leads.find((l) => l.id === t.lead_id)?.name}
              </small>
            </button>
          </div>
        ))}
        {!data.tasks.length && (
          <div className="crm-empty">Open a lead to add its first task.</div>
        )}
      </section>
    </div>
  );
}
