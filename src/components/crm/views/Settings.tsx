"use client";
import { download } from "../download";
import { StageForm } from "../StageForm";
import { useWorkspaceContext } from "../context";
import { TeamInvitations } from "../TeamInvitations";
import { TeamMembers } from "../TeamMembers";
import { PlanUsage } from "../PlanUsage";
import { PlanComparison } from "../PlanComparison";
import { AISettings } from "../AISettings";
import { AIUsagePanel } from "../AIUsage";
import { CalendarSettings } from "../CalendarSettings";
import { WhatsAppSettings } from "../WhatsAppSettings";
import { WhatsAppFollowUps } from "../WhatsAppFollowUps";
import { FollowUpSettings } from "../FollowUpSettings";

export function Settings() {
  const { data, stages, busy, mutate, demo, now, reload } = useWorkspaceContext();
  const teamSeesAll = data.organization?.team_sees_all_leads !== false;
  return (
    <div className="crm-settings-stack">
      <AIUsagePanel demo={demo} />
      <AISettings demo={demo} role={data.user.role} />
      <FollowUpSettings demo={demo} role={data.user.role} />
      <div className="crm-overview-grid">
        <div>
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
          <section className="crm-panel">
            <div className="crm-panel-heading">
              <div>
                <h2>Your team</h2>
                <p>
                  {teamSeesAll
                    ? "Everyone sees all of this workspace's leads. Team members reply to and book visits for their own leads."
                    : "Owners and admins see all leads; team members see only the leads assigned to them."}
                </p>
              </div>
            </div>
            <div className="crm-settings-body crm-team">
              {data.user.role === "owner" && (
                <fieldset className="crm-visibility" disabled={busy || demo}>
                  <legend>Team members can see</legend>
                  {[
                    { value: true, label: "All leads", hint: "Best for small teams that share enquiries." },
                    { value: false, label: "Only leads assigned to them", hint: "Keeps each agent's clients private." },
                  ].map((option) => (
                    <label key={option.label}>
                      <input
                        type="radio"
                        name="team-visibility"
                        checked={teamSeesAll === option.value}
                        onChange={async () => {
                          if (await mutate({ action: "teamVisibility", allLeads: option.value }))
                            await reload();
                        }}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.hint}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <TeamMembers
                members={data.members}
                role={data.user.role}
                selfId={data.user.id}
                demo={demo}
                reload={reload}
              />
              <TeamInvitations role={data.user.role} demo={demo} now={now} />
            </div>
          </section>
        </div>
        <div>
          <PlanUsage demo={demo} role={data.user.role} />
          <PlanComparison plan={data.plan.plan} active={data.plan.active} role={data.user.role} />
          <CalendarSettings demo={demo} role={data.user.role} />
          <WhatsAppSettings demo={demo} role={data.user.role} />
          <WhatsAppFollowUps demo={demo} role={data.user.role} />
        </div>
      </div>
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
  );
}
