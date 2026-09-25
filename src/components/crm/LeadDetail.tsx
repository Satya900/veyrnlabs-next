import { Eyebrow } from "@/components/ui/Eyebrow";
import { money } from "@/lib/crm/model";
import type { Lead, Workspace as Data } from "@/lib/crm/model";
import { datetime } from "@/lib/crm/workspace";
import type { WorkspaceChanges } from "@/lib/crm/workspace";
import { ScheduleVisit } from "./ScheduleVisit";

export function LeadDetail({
  current,
  data,
  busy,
  mutate,
  optimisticMutate,
  onEdit,
}: {
  current: Lead;
  data: Data;
  busy: boolean;
  mutate: (body: Record<string, unknown>) => Promise<boolean>;
  optimisticMutate: (
    body: Record<string, unknown>,
    optimisticChanges: WorkspaceChanges,
  ) => Promise<boolean>;
  onEdit: () => void;
}) {
  const sortedActivity = [...data.activities]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .filter((a) => a.lead_id === current.id);
  return (
    <>
      <Eyebrow>LEAD DETAILS</Eyebrow>
      <h2>{current.name}</h2>
      <p>
        {current.company} {current.service && `· ${current.service}`}
      </p>
      <div className="crm-detail-actions">
        <button onClick={onEdit}>Edit details</button>
        <button
          className="crm-primary"
          disabled={busy || !!current.client_id}
          onClick={() => void mutate({ action: "convert", id: current.id })}
        >
          {current.client_id ? "✓ Converted to client" : "Convert to client ↗"}
        </button>
      </div>
      <div className="crm-detail-summary">
        <div>
          <small>Opportunity value</small>
          <strong>{money(current.value)}</strong>
        </div>
        <label>
          Pipeline stage
          <select
            value={current.stage_id}
            disabled={!!current.client_id}
            onChange={(e) => {
              const stage_id = e.target.value;
              const stage = data.stages.find((s) => s.id === stage_id);
              void optimisticMutate(
                { action: "stage", id: current.id, stage_id },
                {
                  leads: [
                    {
                      ...current,
                      stage_id,
                      closed_at: stage?.kind === "open" ? null : new Date().toISOString(),
                    },
                  ],
                },
              );
            }}
          >
            {data.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <dl className="crm-detail-fields">
        <div>
          <dt>Email</dt>
          <dd>{current.email || "Not added"}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{current.phone || "Not added"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{current.source || "Manual"}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{data.members.find((m) => m.id === current.owner_id)?.name || "Unassigned"}</dd>
        </div>
        <div>
          <dt>Next follow-up</dt>
          <dd>{current.follow_up ? datetime(current.follow_up) : "Not scheduled"}</dd>
        </div>
      </dl>
      {current.notes && <div className="crm-notes">{current.notes}</div>}
      <h3>Add an activity</h3>
      <form
        className="crm-activity-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          if (await mutate({ action: "activity", id: current.id, ...Object.fromEntries(f) }))
            form.reset();
        }}
      >
        <select name="kind" aria-label="Activity type">
          <option value="note">Note</option>
          <option value="call">Call</option>
          <option value="meeting">Meeting</option>
        </select>
        <textarea
          name="body"
          aria-label="Activity summary"
          required
          maxLength={5000}
          placeholder="What happened? What’s next?"
        />
        <button disabled={busy}>Save activity</button>
      </form>
      {data.plan.active && <ScheduleVisit leadId={current.id} />}
      <h3>Schedule a task</h3>
      <form
        className="crm-task-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          if (
            await mutate({
              action: "task",
              id: current.id,
              title: f.get("title"),
              due_at: new Date(String(f.get("due_at"))).toISOString(),
            })
          )
            form.reset();
        }}
      >
        <input
          name="title"
          aria-label="Task title"
          placeholder="e.g. Send the proposal"
          required
          maxLength={300}
        />
        <input name="due_at" aria-label="Task due date and time" type="datetime-local" required />
        <button disabled={busy}>Add task</button>
      </form>
      {data.tasks
        .filter((t) => t.lead_id === current.id)
        .map((t) => (
          <label className="crm-inline-task" key={t.id}>
            <input
              type="checkbox"
              checked={t.completed}
              onChange={(e) => {
                const completed = e.target.checked;
                void optimisticMutate(
                  { action: "completeTask", id: t.id, completed },
                  { tasks: [{ ...t, completed }] },
                );
              }}
            />
            {t.title}
            <small>{datetime(t.due_at)}</small>
          </label>
        ))}
      <h3>Activity history</h3>
      <div className="crm-timeline">
        {sortedActivity.map((a) => (
          <article key={a.id}>
            <span className="timeline-dot" />
            <div>
              <small>
                {a.kind} · {datetime(a.created_at)}
              </small>
              <p>{a.body}</p>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
