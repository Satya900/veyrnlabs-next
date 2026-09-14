"use client";
import { useRef } from "react";
import { csvHeaders, exportCsv, money, parseCsv } from "@/lib/crm/model";
import { dateLabel, filterLeads, initials, isOverdueFollowUp, sourceOptions } from "@/lib/crm/workspace";
import { download } from "../download";
import { useWorkspaceContext } from "../context";
import { LeadTable } from "../LeadTable";

export function Leads({
  search,
  setSearch,
  source,
  setSource,
  owner,
  setOwner,
  board,
  setBoard,
  setImportRows,
  setError,
}: {
  search: string;
  setSearch: (v: string) => void;
  source: string;
  setSource: (v: string) => void;
  owner: string;
  setOwner: (v: string) => void;
  board: boolean;
  setBoard: (v: boolean) => void;
  setImportRows: (rows: Record<string, unknown>[] | null) => void;
  setError: (message: string) => void;
}) {
  const { data, stages, now, busy, mutate, setSelected, setEditing, setNewStage } =
    useWorkspaceContext();
  const file = useRef<HTMLInputElement>(null);
  const filtered = filterLeads(data.leads, { search, source, owner });

  return (
    <>
      <div className="crm-toolbar">
        <input
          className="crm-search"
          aria-label="Search leads"
          placeholder="Search name, company, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filter by source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">All sources</option>
          {sourceOptions(data.leads).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Filter by owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">All owners</option>
          <option value="unassigned">Unassigned</option>
          {data.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <div className="crm-view-toggle">
          <button aria-pressed={board} onClick={() => setBoard(true)}>
            Board
          </button>
          <button aria-pressed={!board} onClick={() => setBoard(false)}>
            List
          </button>
        </div>
        <button onClick={() => file.current?.click()}>↑ Import</button>
        <button
          onClick={() =>
            download(
              "veyrn-leads.csv",
              exportCsv(
                filtered.map((l) => ({
                  ...l,
                  stage: stages.find((s) => s.id === l.stage_id)?.name,
                  owner: data.members.find((m) => m.id === l.owner_id)?.name || "Unassigned",
                })),
                [...csvHeaders, "stage", "owner", "follow_up", "created_at", "closed_at", "client_id"],
              ),
            )
          }
        >
          ↓ Export
        </button>
        <input
          ref={file}
          hidden
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              if (f.size > 2_000_000) throw new Error("CSV must be smaller than 2 MB.");
              const rows = parseCsv(await f.text());
              if (!rows.length) throw new Error("CSV has no leads to import.");
              setImportRows(rows);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Unable to read CSV.");
            }
          }}
        />
      </div>
      <div className="crm-section-heading">
        <span className="crm-muted">
          {filtered.length} opportunities ·{" "}
          {money(
            filtered
              .filter((l) => stages.find((s) => s.id === l.stage_id)?.kind === "open")
              .reduce((sum, l) => sum + l.value, 0),
          )}{" "}
          open value
        </span>
        <button
          onClick={() =>
            download(
              "lead-import-template.csv",
              exportCsv([
                {
                  name: "Example Contact",
                  company: "Example Company",
                  email: "contact@example.com",
                  phone: "",
                  service: "Website",
                  value: 50000,
                  source: "Referral",
                  notes: "",
                },
              ]),
            )
          }
        >
          Download import template
        </button>
      </div>
      {board ? (
        <div className="crm-board">
          {stages.map((s) => {
            const rows = filtered.filter((l) => l.stage_id === s.id);
            return (
              <section
                className="crm-column"
                key={s.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy)
                    void mutate({
                      action: "stage",
                      id: e.dataTransfer.getData("text/plain"),
                      stage_id: s.id,
                    });
                }}
              >
                <div className="column-heading">
                  <span>
                    <i
                      style={{
                        background:
                          s.kind === "lost" ? "var(--color-mute)" : "var(--color-primary)",
                      }}
                    />
                    {s.name}
                    <b>{rows.length}</b>
                  </span>
                  <small>{money(rows.reduce((sum, l) => sum + l.value, 0))}</small>
                </div>
                {rows.map((l) => (
                  <article
                    draggable={!busy && !l.client_id}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                    className="crm-lead-card"
                    key={l.id}
                  >
                    <button className="card-title" onClick={() => setSelected(l.id)}>
                      <span className="crm-avatar">{initials(l.name)}</span>
                      <span>
                        <strong>{l.name}</strong>
                        <small>{l.company || "Individual"}</small>
                      </span>
                      <span>↗</span>
                    </button>
                    <p>{l.service || "Service to be discussed"}</p>
                    <strong className="card-value">{money(l.value)}</strong>
                    <div className="card-bottom">
                      <span>{l.source || "Manual"}</span>
                      <span className={isOverdueFollowUp(l, stages, now) ? "crm-overdue" : ""}>
                        {l.follow_up ? `◷ ${dateLabel(l.follow_up)}` : "No follow-up"}
                      </span>
                    </div>
                  </article>
                ))}
                <button
                  className="column-add"
                  onClick={() => {
                    setNewStage(s.id);
                    setEditing("new");
                  }}
                >
                  ＋ Add lead
                </button>
              </section>
            );
          })}
        </div>
      ) : (
        <section className="crm-panel">
          <LeadTable
            rows={filtered}
            stages={stages}
            members={data.members}
            now={now}
            onSelect={setSelected}
          />
        </section>
      )}
    </>
  );
}
