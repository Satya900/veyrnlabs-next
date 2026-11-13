"use client";
import { useCallback, useEffect, useState } from "react";
import { crmFetch } from "../activity";
import { useWorkspaceContext } from "../context";
import {
  AVAILABILITY,
  FILE_KINDS,
  MAX_FILE_BYTES,
  PROJECT_STATUSES,
  inrShort,
  priceRange,
  type Project,
  type ProjectFile,
  type ProjectUnit,
} from "@/lib/crm/projects";

type State = {
  projects: Project[];
  units: (ProjectUnit & { id: string; project_id: string })[];
  files: ProjectFile[];
  leadCounts: Record<string, number>;
  canEdit: boolean;
};
const STATUS: Record<Project["status"], string> = {
  upcoming: "Upcoming",
  launched: "New launch",
  under_construction: "Under construction",
  ready: "Ready to move",
  sold_out: "Sold out",
};
const AVAIL: Record<ProjectUnit["availability"], string> = { available: "Available", few_left: "Few left", sold_out: "Sold out" };
const KIND: Record<ProjectFile["kind"], string> = {
  brochure: "Brochure",
  floor_plan: "Floor plan",
  price_sheet: "Price sheet",
  photo: "Photo",
  other: "Other",
};
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// Prices are edited as text ("85 L", "1.2 Cr") and read on the server.
const priceText = (n: number | null) => (n == null ? "" : inrShort(n));

async function call(body: Record<string, unknown>) {
  const res = await crmFetch("/api/crm/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error ?? "That didn't work.");
  return result;
}

export function Projects() {
  const { demo, reload } = useWorkspaceContext();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await crmFetch("/api/crm/projects", { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setState(result);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Projects couldn't load.");
    }
  }, []);
  useEffect(() => {
    if (demo) return;
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [demo, load]);
  // After any change: refresh this page, and the workspace so lead forms see new project names.
  const changed = async () => {
    await load();
    await reload();
  };

  if (demo)
    return (
      <section className="crm-panel">
        <div className="crm-settings-body">
          <p className="crm-muted">Add your projects, unit prices and brochures in your live workspace.</p>
        </div>
      </section>
    );
  if (error && !state) return <p role="alert" className="crm-error">{error}</p>;
  if (!state) return <p className="crm-muted">Loading projects…</p>;
  const visible = state.projects.filter((p) => showArchived || !p.archived);
  const archivedCount = state.projects.filter((p) => p.archived).length;

  return (
    <div className="crm-projects">
      <div className="crm-projects-bar">
        <p>
          {state.projects.length
            ? "Your AI answers from these prices and availability, and your team sends brochures from the WhatsApp inbox."
            : "Add the projects you sell. Your AI then answers price and availability questions from them, and your team can send brochures on WhatsApp in one tap."}
        </p>
        <div>
          {archivedCount > 0 && (
            <button type="button" onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
            </button>
          )}
          {state.canEdit && (
            <button type="button" className="crm-primary" onClick={() => setOpen("new")}>
              ＋ New project
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="crm-error">{error}</p>}

      {open === "new" && (
        <ProjectEditor
          units={[]}
          files={[]}
          onClose={() => setOpen(null)}
          onDeleted={changed}
          onSaved={async (id) => {
            await changed();
            setOpen(id);
          }}
        />
      )}

      {!visible.length && open !== "new" && (
        <section className="crm-panel crm-projects-empty">
          <strong>No projects yet</strong>
          <p>Start with one you&apos;re selling now: its unit types, price ranges and the brochure.</p>
        </section>
      )}

      {visible.map((p) => {
        const units = state.units.filter((u) => u.project_id === p.id);
        const files = state.files.filter((f) => f.project_id === p.id);
        return open === p.id && state.canEdit ? (
          <ProjectEditor
            key={p.id}
            project={p}
            units={units}
            files={files}
            onClose={() => setOpen(null)}
            onSaved={changed}
            onDeleted={changed}
          />
        ) : (
          <article key={p.id} className={`crm-panel crm-project-card${p.archived ? " is-archived" : ""}`}>
            <header>
              <div>
                <h2>{p.name}</h2>
                <p>{[p.location, p.developer && `by ${p.developer}`].filter(Boolean).join(" · ") || "No location added"}</p>
              </div>
              <span className={`crm-badge${p.status === "sold_out" ? " lost" : p.status === "ready" ? " won" : ""}`}>
                {p.archived ? "Archived" : STATUS[p.status]}
              </span>
            </header>
            {units.length > 0 && (
              <ul className="crm-project-units">
                {units.map((u) => (
                  <li key={u.id} className={u.availability === "sold_out" ? "is-sold" : undefined}>
                    <strong>{u.name}</strong>
                    {u.size && <small>{u.size}</small>}
                    <span>{priceRange(u)}</span>
                    <em>{AVAIL[u.availability]}</em>
                  </li>
                ))}
              </ul>
            )}
            <footer>
              <span>
                {[
                  p.possession && `Possession ${p.possession}`,
                  p.rera && `RERA ${p.rera}`,
                  `${files.length} file${files.length === 1 ? "" : "s"}`,
                  `${state.leadCounts[p.id] ?? 0} lead${state.leadCounts[p.id] === 1 ? "" : "s"}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="crm-project-links">
                {files.slice(0, 3).map((f) => (
                  <a key={f.id} href={f.url} target="_blank" rel="noopener">
                    {KIND[f.kind]}: {f.name} ↗
                  </a>
                ))}
                {state.canEdit && (
                  <button type="button" onClick={() => setOpen(p.id)}>
                    Edit
                  </button>
                )}
              </span>
            </footer>
          </article>
        );
      })}
    </div>
  );

}

function ProjectEditor({ project, units, files, onClose, onSaved, onDeleted }: {
  project?: Project;
  units: ProjectUnit[];
  files: ProjectFile[];
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [rows, setRows] = useState<{ name: string; size: string; price_min: string; price_max: string; availability: ProjectUnit["availability"] }[]>(
    units.length
      ? units.map((u) => ({ name: u.name, size: u.size, price_min: priceText(u.price_min), price_max: priceText(u.price_max), availability: u.availability }))
      : [{ name: "2BHK", size: "", price_min: "", price_max: "", availability: "available" }],
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [fail, setFail] = useState("");
  const run = async (work: () => Promise<void>, done = "") => {
    setBusy(true);
    setFail("");
    setNote("");
    try {
      await work();
      if (done) setNote(done);
    } catch (err) {
      setFail(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  const setRow = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <section className="crm-panel crm-project-editor">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = Object.fromEntries(new FormData(e.currentTarget));
          void run(async () => {
            const result = await call({
              action: "saveProject",
              id: project?.id,
              project: form,
              units: rows.filter((r) => r.name.trim()),
            });
            await onSaved(result.id);
          }, "Saved. Your AI now uses these details.");
        }}
      >
        <div className="crm-panel-heading">
          <div>
            <h2>{project ? `Edit ${project.name}` : "New project"}</h2>
            <p>Only add facts you&apos;re happy for the AI to tell customers.</p>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="crm-project-fields">
          <label>
            Project name
            <input name="name" required maxLength={120} defaultValue={project?.name} placeholder="Prestige Lakeside" />
          </label>
          <label>
            Location
            <input name="location" maxLength={200} defaultValue={project?.location} placeholder="Whitefield, Bengaluru" />
          </label>
          <label>
            Developer
            <input name="developer" maxLength={120} defaultValue={project?.developer} />
          </label>
          <label>
            Status
            <select name="status" defaultValue={project?.status ?? "launched"}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS[s]}</option>
              ))}
            </select>
          </label>
          <label>
            Possession
            <input name="possession" maxLength={60} defaultValue={project?.possession} placeholder="Dec 2027" />
          </label>
          <label>
            RERA number
            <input name="rera" maxLength={80} defaultValue={project?.rera} />
          </label>
          <label className="crm-project-wide">
            About the project
            <textarea name="description" rows={3} maxLength={3000} defaultValue={project?.description} placeholder="Towers, total units, land area, nearby schools and offices, offers…" />
          </label>
          <label className="crm-project-wide">
            Amenities
            <input name="amenities" maxLength={1000} defaultValue={project?.amenities} placeholder="Clubhouse, pool, gym, kids' play area" />
          </label>
        </div>

        <div className="crm-unit-editor">
          <div className="crm-unit-head">
            <strong>Unit types and prices</strong>
            <small>Type prices like 85 L or 1.2 Cr. For one price, fill only &ldquo;Price from&rdquo;. Leave both empty for &ldquo;price on request&rdquo;.</small>
          </div>
          <div className="crm-unit-rows">
            {rows.length > 0 && (
              <div className="crm-unit-row crm-unit-labels" aria-hidden="true">
                <span>Unit type</span>
                <span>Size</span>
                <span>Price from</span>
                <span>Price to (optional)</span>
                <span>Availability</span>
                <span />
              </div>
            )}
            {rows.map((r, i) => (
              <div key={i} className="crm-unit-row">
                <input aria-label="Unit type" value={r.name} maxLength={60} placeholder="3BHK" onChange={(e) => setRow(i, { name: e.target.value })} />
                <input aria-label="Size" value={r.size} maxLength={60} placeholder="1,650 sq ft" onChange={(e) => setRow(i, { size: e.target.value })} />
                <input aria-label="Price from" value={r.price_min} maxLength={30} placeholder="From: 85 L" onChange={(e) => setRow(i, { price_min: e.target.value })} />
                <input aria-label="Price to" value={r.price_max} maxLength={30} placeholder="To: 95 L" onChange={(e) => setRow(i, { price_max: e.target.value })} />
                <select aria-label="Availability" value={r.availability} onChange={(e) => setRow(i, { availability: e.target.value as ProjectUnit["availability"] })}>
                  {AVAILABILITY.map((a) => (
                    <option key={a} value={a}>{AVAIL[a]}</option>
                  ))}
                </select>
                <button type="button" aria-label="Remove unit type" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
          {rows.length < 30 && (
            <button type="button" onClick={() => setRows([...rows, { name: "", size: "", price_min: "", price_max: "", availability: "available" }])}>
              ＋ Add unit type
            </button>
          )}
        </div>

        {fail && <p role="alert" className="crm-error">{fail}</p>}
        {note && <p role="status" className="crm-success">{note}</p>}
        <div className="crm-project-actions">
          <button type="submit" className="crm-primary" disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : project ? "Save changes" : "Add project"}
          </button>
          {project && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(async () => {
                  await call({ action: "archive", id: project.id, archived: !project.archived });
                  await onSaved(project.id);
                })}
              >
                {project.archived ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                className="crm-danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete ${project.name} with its units and files? Leads tagged with it keep everything else.`))
                    void run(async () => {
                      await call({ action: "deleteProject", id: project.id });
                      onClose();
                      await onDeleted();
                    });
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </form>

      {project ? (
        <ProjectFiles project={project} files={files} busy={busy} run={run} onChanged={() => onSaved(project.id)} />
      ) : (
        <p className="crm-muted crm-project-files-hint">Add the project first, then upload its brochure and floor plans.</p>
      )}
    </section>
  );
}

function ProjectFiles({ project, files, busy, run, onChanged }: {
  project: Project;
  files: ProjectFile[];
  busy: boolean;
  run: (work: () => Promise<void>, done?: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [kind, setKind] = useState<ProjectFile["kind"]>("brochure");
  return (
    <div className="crm-project-files">
      <div className="crm-unit-head">
        <strong>Brochures and files</strong>
        <small>PDF, JPG, PNG or WebP up to 15 MB. Anyone with the link can open a file, so only upload what you&apos;d share with buyers.</small>
      </div>
      {files.length > 0 && (
        <ul>
          {files.map((f) => (
            <li key={f.id}>
              <a href={f.url} target="_blank" rel="noopener">
                <strong>{f.name}</strong>
                <small>{KIND[f.kind]} · {f.mime === "application/pdf" ? "PDF" : "Image"} · {kb(f.size_bytes)}</small>
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const name = window.prompt("File name", f.name);
                  if (name?.trim()) void run(async () => {
                    await call({ action: "renameFile", id: f.id, name });
                    await onChanged();
                  });
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="crm-danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete ${f.name}? Links already sent on WhatsApp will stop working.`))
                    void run(async () => {
                      await call({ action: "deleteFile", id: f.id });
                      await onChanged();
                    });
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="crm-project-upload">
        <select aria-label="File type" value={kind} onChange={(e) => setKind(e.target.value as ProjectFile["kind"])}>
          {FILE_KINDS.map((k) => (
            <option key={k} value={k}>{KIND[k]}</option>
          ))}
        </select>
        <label className={`crm-upload-button${busy ? " is-busy" : ""}`}>
          {busy ? "Uploading…" : "Upload file"}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void run(async () => {
                if (file.size > MAX_FILE_BYTES) throw new Error("Files can be up to 15 MB. Compress the PDF and try again.");
                const { uploadUrl, path } = await call({
                  action: "uploadUrl",
                  projectId: project.id,
                  fileName: file.name,
                  mime: file.type,
                  size: file.size,
                });
                // Straight to storage, so large brochures don't pass through our server.
                const form = new FormData();
                form.append("cacheControl", "3600");
                form.append("", file);
                const put = await fetch(uploadUrl, { method: "PUT", headers: { "x-upsert": "false" }, body: form });
                if (!put.ok) throw new Error("The upload failed. Check your connection and try again.");
                await call({
                  action: "addFile",
                  projectId: project.id,
                  path,
                  kind,
                  name: file.name.replace(/\.[A-Za-z0-9]{1,5}$/, "").slice(0, 120),
                });
                await onChanged();
              }, "File added.");
            }}
          />
        </label>
      </div>
    </div>
  );
}
