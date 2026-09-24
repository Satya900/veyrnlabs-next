"use client";
import { download } from "../download";
import { StageForm } from "../StageForm";
import { useWorkspaceContext } from "../context";
import { TeamInvitations } from "../TeamInvitations";
import { TeamMembers } from "../TeamMembers";
import { PlanUsage } from "../PlanUsage";
import { AISettings } from "../AISettings";
import { CalendarSettings } from "../CalendarSettings";
import { WhatsAppSettings } from "../WhatsAppSettings";

export function Settings() {
  const { data, stages, busy, mutate, demo, now, reload } = useWorkspaceContext();
  return (
    <div>
      <AISettings demo={demo} role={data.user.role} />
      <WhatsAppSettings demo={demo} role={data.user.role} />
      <div className="crm-overview-grid">
        <section className="crm-panel">
          <div className="crm-panel-heading">
            <div>
              <h2>Pipeline stages</h2>
              <p>
                Rename stages and set their display order. Won/lost meanings are
                fixed.
              </p>
            </div>
          </div>
          <div className="crm-settings-body">
            {stages.map((s) => (
              <StageForm
                key={s.id + s.name + s.position}
                stage={s}
                disabled={busy || data.user.role === "team"}
                save={mutate}
              />
            ))}
            {data.user.role !== "team" && (
              <StageForm disabled={busy} save={mutate} />
            )}
          </div>
        </section>
        <div>
          <PlanUsage demo={demo} role={data.user.role} />
          <CalendarSettings demo={demo} role={data.user.role} />
          <section className="crm-panel">
            <div className="crm-panel-heading">
              <div>
                <h2>Your team</h2>
                <p>
                  Owners and admins see all leads; team members see assigned
                  leads.
                </p>
              </div>
            </div>
            <TeamMembers
              members={data.members}
              role={data.user.role}
              selfId={data.user.id}
              demo={demo}
              reload={reload}
            />
            <TeamInvitations role={data.user.role} demo={demo} now={now} />
          </section>
          <section className="crm-panel crm-export-panel">
            <h2>Take your data with you</h2>
            <p>
              Download all records available to your account, including history
              and tasks.
            </p>
            <button
              onClick={() =>
                download(
                  "veyrn-workspace.json",
                  JSON.stringify(data, null, 2),
                  "application/json",
                )
              }
            >
              ↓ Export workspace
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
