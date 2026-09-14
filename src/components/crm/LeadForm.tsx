import { useState } from "react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { Lead, Workspace as Data } from "@/lib/crm/model";
import { findDuplicateClient, findDuplicateLead } from "@/lib/crm/workspace";

export function LeadForm({
  lead,
  defaultStage,
  data,
  busy,
  save,
  onOpenExisting,
}: {
  lead?: Lead;
  defaultStage?: string;
  data: Data;
  busy: boolean;
  save: (values: Record<string, unknown>) => Promise<void>;
  onOpenExisting?: (leadId: string) => void;
}) {
  const localTime = lead?.follow_up
    ? new Date(
        Date.parse(lead.follow_up) - new Date(lead.follow_up).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
  const [emailCheck, setEmailCheck] = useState(lead?.email ?? "");
  const duplicateLead = findDuplicateLead(data.leads, emailCheck, lead?.id);
  const duplicateClient = duplicateLead
    ? undefined
    : findDuplicateClient(data.clients, emailCheck);
  return (
    <>
      <Eyebrow>{lead ? "KEEP THE DETAILS CURRENT" : "A NEW POSSIBILITY"}</Eyebrow>
      <h2>{lead ? "Edit lead" : "Add a lead"}</h2>
      <p>A few details now. A stronger relationship later.</p>
      <form
        className="crm-lead-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          await save({
            ...values,
            value: Number(values.value),
            follow_up: values.follow_up ? new Date(String(values.follow_up)).toISOString() : null,
          });
        }}
      >
        <div className="crm-form-grid">
          {[
            { name: "name", label: "Contact name", required: true },
            { name: "company", label: "Company" },
            { name: "email", label: "Email", type: "email" },
            { name: "phone", label: "Phone", type: "tel" },
            { name: "service", label: "Service / requirement" },
            { name: "value", label: "Estimated value (INR)", type: "number" },
          ].map((f) => (
            <label key={f.name}>
              {f.label}
              <input
                name={f.name}
                type={f.type || "text"}
                required={f.required}
                maxLength={200}
                min={f.type === "number" ? 0 : undefined}
                max={f.type === "number" ? 1e12 : undefined}
                step={f.type === "number" ? "0.01" : undefined}
                defaultValue={
                  lead
                    ? String(lead[f.name as keyof Lead] ?? "")
                    : f.name === "value"
                      ? "0"
                      : ""
                }
                onChange={f.name === "email" ? (e) => setEmailCheck(e.target.value) : undefined}
              />
            </label>
          ))}
          <label>
            Source
            <input
              name="source"
              list="crm-sources"
              maxLength={200}
              defaultValue={lead?.source || "Manual"}
            />
            <datalist id="crm-sources">
              {["Website", "Referral", "LinkedIn", "Outbound", "Instagram", "Manual"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </datalist>
          </label>
          <label>
            Owner
            <select
              name="owner_id"
              defaultValue={lead?.owner_id || (data.user.role === "team" ? data.user.id : "")}
              disabled={data.user.role === "team"}
            >
              <option value="">Unassigned</option>
              {data.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stage
            <select
              name="stage_id"
              defaultValue={
                lead?.stage_id ||
                defaultStage ||
                [...data.stages].filter((s) => s.kind === "open").sort((a, b) => a.position - b.position)[0]?.id
              }
            >
              {[...data.stages]
                .sort((a, b) => a.position - b.position)
                .filter((s) => !lead?.client_id || s.kind === "won")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Next follow-up
            <input name="follow_up" type="datetime-local" defaultValue={localTime} />
          </label>
        </div>
        <label>
          Notes
          <textarea
            name="notes"
            maxLength={5000}
            rows={4}
            defaultValue={lead?.notes}
            placeholder="Context, requirements, or something to remember…"
          />
        </label>
        {(duplicateLead || duplicateClient) && (
          <div className="crm-notice" role="status">
            {duplicateLead
              ? `A lead with this email already exists: ${duplicateLead.name}${duplicateLead.company ? ` (${duplicateLead.company})` : ""}.`
              : `A client with this email already exists: ${duplicateClient!.name}${duplicateClient!.company ? ` (${duplicateClient!.company})` : ""}.`}{" "}
            You can save anyway, or open the existing record instead.
            {duplicateLead && onOpenExisting && (
              <>
                {" "}
                <button type="button" onClick={() => onOpenExisting(duplicateLead.id)}>
                  Open existing lead ↗
                </button>
              </>
            )}
          </div>
        )}
        <button className="crm-primary" disabled={busy}>
          {busy ? "Saving…" : lead ? "Save changes" : "Create lead →"}
        </button>
      </form>
    </>
  );
}
