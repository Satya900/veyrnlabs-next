"use client";
import { download } from "../download";
import { StageForm } from "../StageForm";
import { useWorkspaceContext } from "../context";
import { initials } from "@/lib/crm/workspace";

export function Settings() {
  const { data, stages, busy, mutate } = useWorkspaceContext();
  return (
    <div className="crm-overview-grid">
      <section className="crm-panel">
        <div className="crm-panel-heading">
          <div>
            <h2>Pipeline stages</h2>
            <p>Rename stages and set their display order. Won/lost meanings are fixed.</p>
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
          {data.user.role !== "team" && <StageForm disabled={busy} save={mutate} />}
        </div>
      </section>
      <div>
        <section className="crm-panel">
          <div className="crm-panel-heading">
            <div>
              <h2>Your team</h2>
              <p>Owners and admins see all leads; team members see assigned leads.</p>
            </div>
          </div>
          {data.members.map((m) => (
            <div key={m.id} className="crm-follow-row">
              <span className="crm-avatar">{initials(m.name)}</span>
              <strong>{m.name}</strong>
              <span className="crm-badge">{m.role}</span>
            </div>
          ))}
          <div className="crm-chart-footer">
            Account provisioning and role changes are managed by the workspace
            owner in Supabase for this release.
          </div>
        </section>
        <section className="crm-panel crm-export-panel">
          <h2>Take your data with you</h2>
          <p>Download all records available to your account, including history and tasks.</p>
          <button
            onClick={() =>
              download("veyrn-workspace.json", JSON.stringify(data, null, 2), "application/json")
            }
          >
            ↓ Export workspace
          </button>
        </section>
      </div>
    </div>
  );
}
