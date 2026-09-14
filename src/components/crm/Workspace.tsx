"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Eyebrow } from "@/components/ui/Eyebrow";
import {
  csvHeaders,
  demoWorkspace,
  exportCsv,
  metrics,
  money,
  parseCsv,
  validateLead,
} from "@/lib/crm/model";
import type { Lead, Workspace as Data, Stage } from "@/lib/crm/model";

type View =
  "Overview" | "Leads" | "Clients" | "Follow-ups" | "Reports" | "Settings";
const navigation: { name: View; icon: string }[] = [
  { name: "Overview", icon: "◫" },
  { name: "Leads", icon: "▤" },
  { name: "Clients", icon: "♧" },
  { name: "Follow-ups", icon: "◷" },
  { name: "Reports", icon: "▥" },
  { name: "Settings", icon: "⚙" },
];
const dateLabel = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const datetime = (s: string) =>
  new Date(s).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
const initials = (s: string) =>
  s
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
function download(
  name: string,
  content: string,
  type = "text/csv;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Workspace({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<View>("Overview");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");
  const [board, setBoard] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Lead | "new" | null>(null);
  const [newStage, setNewStage] = useState<string | undefined>();
  const [importRows, setImportRows] = useState<
    Record<string, unknown>[] | null
  >(null);
  const [from, setFrom] = useState(() => {
    const today = new Date();
    return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [now, setNow] = useState(() => Date.now());
  const file = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  async function reload() {
    const res = await fetch("/api/crm", { cache: "no-store" });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    setData(result);
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (demo)
      Promise.resolve().then(() => {
        if (active) setData(demoWorkspace());
      });
    else
      fetch("/api/crm", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          if (active) setData(result);
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [demo]);
  useEffect(() => {
    if (editing || selected || importRows) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing, selected, importRows]);
  const close = () => {
    if (!busy) {
      setEditing(null);
      setSelected(null);
      setImportRows(null);
      setNewStage(undefined);
    }
  };
  async function mutate(body: Record<string, unknown>) {
    if (!data || busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!demo) {
        const res = await fetch("/api/crm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        try {
          await reload();
        } catch {
          setError(
            "Your change was saved, but refreshing the workspace failed. Reload to see it; do not resubmit.",
          );
        }
      } else {
        const next = structuredClone(data);
        const timestamp = new Date().toISOString();
        const log = (id: string, text: string, kind = "note") =>
          next.activities.push({
            id: crypto.randomUUID(),
            lead_id: id,
            body: text,
            kind,
            created_at: timestamp,
          });
        const lead = next.leads.find((l) => l.id === body.id);
        if (body.action === "saveLead" || body.action === "import") {
          const rows =
            body.action === "import"
              ? (body.rows as Record<string, unknown>[])
              : [body.lead as Record<string, unknown>];
          for (const row of rows) {
            const checked = validateLead(row);
            const existing = body.action === "saveLead" ? lead : undefined;
            const id = existing?.id ?? crypto.randomUUID();
            const stage_id = String(
              row.stage_id ||
                next.stages
                  .filter((s) => s.kind === "open")
                  .sort((a, b) => a.position - b.position)[0].id,
            );
            if (
              existing?.client_id &&
              next.stages.find((s) => s.id === stage_id)?.kind !== "won"
            )
              throw new Error("Converted leads must remain won.");
            const saved = {
              ...existing,
              ...checked,
              id,
              stage_id,
              owner_id: row.owner_id || null,
              created_at: existing?.created_at ?? timestamp,
              closed_at:
                next.stages.find((s) => s.id === stage_id)?.kind === "open"
                  ? null
                  : (existing?.closed_at ?? timestamp),
              client_id: existing?.client_id ?? null,
            } as Lead;
            if (existing) next.leads[next.leads.indexOf(existing)] = saved;
            else next.leads.unshift(saved);
            log(
              id,
              existing ? "Lead details updated" : "Lead created",
              existing ? "updated" : "created",
            );
          }
        } else if (body.action === "stage" && lead) {
          const stage = next.stages.find((s) => s.id === body.stage_id)!;
          if (lead.client_id && stage.kind !== "won")
            throw new Error("Converted leads must remain won.");
          lead.stage_id = stage.id;
          lead.closed_at = stage.kind === "open" ? null : timestamp;
          log(lead.id, `Moved to ${stage.name}`, "stage");
        } else if (body.action === "convert" && lead && !lead.client_id) {
          const existing = next.clients.find(
            (c) =>
              c.email && c.email.toLowerCase() === lead.email.toLowerCase(),
          );
          const id = existing?.id ?? crypto.randomUUID();
          if (!existing)
            next.clients.push({
              id,
              name: lead.name,
              company: lead.company,
              email: lead.email,
              phone: lead.phone,
              owner_id: lead.owner_id,
              created_at: timestamp,
            });
          lead.client_id = id;
          lead.stage_id = next.stages.find((s) => s.kind === "won")!.id;
          lead.closed_at = timestamp;
          log(lead.id, "Converted to client", "converted");
        } else if (body.action === "activity" && lead)
          log(lead.id, String(body.body), String(body.kind));
        else if (body.action === "task" && lead)
          next.tasks.push({
            id: crypto.randomUUID(),
            lead_id: lead.id,
            title: String(body.title),
            due_at: String(body.due_at),
            completed: false,
            created_at: timestamp,
          });
        else if (body.action === "completeTask") {
          const task = next.tasks.find((t) => t.id === body.id);
          if (task) task.completed = Boolean(body.completed);
        } else if (body.action === "saveStage") {
          const stage = next.stages.find((s) => s.id === body.id);
          if (next.stages.some((s) => s.name === body.name && s.id !== body.id))
            throw new Error("A stage with this name already exists.");
          if (stage) {
            stage.name = String(body.name);
            stage.position = Number(body.position);
          } else
            next.stages.push({
              id: crypto.randomUUID(),
              name: String(body.name),
              position: Number(body.position),
              kind: "open",
            });
        }
        setData(next);
      }
      setMessage(
        demo
          ? "Updated sample workspace. Demo changes reset when you reload."
          : "Saved to your workspace.",
      );
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to save. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <main className="crm-loading">
        <Logo href="/" eager />
        <h1>{error ? "Workspace unavailable" : "Opening your workspace…"}</h1>
        {error && (
          <>
            <p role="alert">{error}</p>
            <Link href="/crm/login">Go to sign in</Link>
            <button
              onClick={() => {
                setError("");
                reload().catch((e) => setError(e.message));
              }}
            >
              Try again
            </button>
          </>
        )}
      </main>
    );
  const stages = [...data.stages].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
  const stageOf = (l: Lead) => stages.find((s) => s.id === l.stage_id);
  const filtered = data.leads.filter(
    (l) =>
      (!search ||
        [l.name, l.company, l.email, l.phone, l.service].some((s) =>
          s.toLowerCase().includes(search.toLowerCase()),
        )) &&
      (!source || l.source === source) &&
      (!owner || (owner === "unassigned" ? !l.owner_id : l.owner_id === owner)),
  );
  const summary = metrics(data, from, to);
  const overdue = data.tasks.filter(
    (t) => !t.completed && Date.parse(t.due_at) < now,
  );
  const dueLeads = data.leads.filter(
    (l) =>
      l.follow_up &&
      Date.parse(l.follow_up) <= now &&
      stageOf(l)?.kind === "open",
  );
  const current = data.leads.find((l) => l.id === selected);
  const sortedActivity = [...data.activities].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const changeView = (v: View) => {
    setView(v);
    setSearch("");
    setSource("");
    setOwner("");
  };
  const dateControls = (
    <div className="crm-dates">
      <label>
        From
        <input
          aria-label="Report start date"
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <span>—</span>
      <label>
        To
        <input
          aria-label="Report end date"
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
    </div>
  );
  const leadTable = (rows: Lead[]) => (
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
                <button
                  className="crm-contact"
                  onClick={() => setSelected(l.id)}
                >
                  <span className="crm-avatar">{initials(l.name)}</span>
                  <span>
                    <strong>{l.name}</strong>
                    <small>{l.company || l.email || "Individual"}</small>
                  </span>
                </button>
              </td>
              <td>
                <span className={`crm-badge ${stageOf(l)?.kind}`}>
                  {stageOf(l)?.name}
                </span>
              </td>
              <td>{money(l.value)}</td>
              <td>{l.source || "Manual"}</td>
              <td
                className={
                  l.follow_up &&
                  Date.parse(l.follow_up) < now &&
                  stageOf(l)?.kind === "open"
                    ? "crm-overdue"
                    : ""
                }
              >
                {l.follow_up ? datetime(l.follow_up) : "Not scheduled"}
              </td>
              <td>
                {data.members.find((m) => m.id === l.owner_id)?.name ||
                  "Unassigned"}
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

  return (
    <div className="crm-shell">
      <aside className="crm-sidebar">
        <Logo href="/" eager />
        <div className="crm-workspace-name">
          <span className="status-dot" aria-hidden="true" />
          <div>
            Veyrn Labs<small>Agency workspace</small>
          </div>
          <span>⌄</span>
        </div>
        <span className="crm-nav-label">WORKSPACE</span>
        <nav aria-label="CRM navigation">
          {navigation.map((n) => (
            <button
              key={n.name}
              aria-current={view === n.name ? "page" : undefined}
              onClick={() => changeView(n.name)}
            >
              <span aria-hidden="true">{n.icon}</span>
              {n.name}
              {n.name === "Follow-ups" &&
                overdue.length + dueLeads.length > 0 && (
                  <b>{overdue.length + dueLeads.length}</b>
                )}
            </button>
          ))}
        </nav>
        <div className="crm-sidebar-bottom">
          <div className="crm-sidebar-tip">
            <span>MAKE YOUR NEXT MOVE</span>
            <p>Every great project starts with a conversation.</p>
            <button onClick={() => setEditing("new")}>
              Add your next lead ↗
            </button>
          </div>
          <div className="crm-profile">
            <span className="crm-avatar">{initials(data.user.name)}</span>
            <div>
              <strong>{data.user.name}</strong>
              <small>
                {demo ? "Demo workspace" : `${data.user.role} · Veyrn Labs`}
              </small>
            </div>
            {!demo && (
              <button
                aria-label="Sign out"
                onClick={async () => {
                  const res = await fetch("/api/crm/session", {
                    method: "DELETE",
                  });
                  if (res.ok) {
                    router.push("/crm/login");
                    router.refresh();
                  } else setError("Unable to sign out. Please try again.");
                }}
              >
                ↪
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="crm-main">
        <header className="crm-topbar">
          <span>
            Workspace <span className="crm-slash">/</span>{" "}
            <strong>{view}</strong>
          </span>
          <div>
            <span className="crm-status-dot" />
            {demo ? "Sample workspace" : "Connected workspace"}
            <span className="crm-avatar small">{initials(data.user.name)}</span>
          </div>
        </header>
        {demo && (
          <div className="crm-demo-banner">
            <span>
              <strong>Demo mode</strong> · Sample data only. Changes reset on
              reload.
            </span>
            <Link href="/crm/login">Connect your workspace ↗</Link>
          </div>
        )}
        <main className="crm-content">
          <div className="crm-page-heading">
            <div>
              <Eyebrow>
                {view === "Overview"
                  ? "THE BIG PICTURE"
                  : "YOUR BUSINESS, ORGANIZED"}
              </Eyebrow>
              <h1>
                {view === "Overview"
                  ? "A clearer view of what’s next."
                  : view === "Follow-ups"
                    ? "Keep the conversation going."
                    : view}
              </h1>
              <p>
                {
                  {
                    Overview:
                      "Your opportunities, relationships, and next steps. All in one place.",
                    Leads: "Turn your next conversation into your next client.",
                    Clients:
                      "The relationships you’re building something great with.",
                    "Follow-ups": "A little follow-through goes a long way.",
                    Reports: "Understand what’s moving your business forward.",
                    Settings: "Make this workspace work for you.",
                  }[view]
                }
              </p>
            </div>
            {view !== "Settings" && (
              <button className="crm-primary" onClick={() => setEditing("new")}>
                <span>＋</span> Add lead
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="crm-error">
              {error}{" "}
              <Link href="/crm/login" target="_blank">
                Sign in
              </Link>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {message && (
            <div role="status" className="crm-success">
              {message}
              <button
                aria-label="Dismiss notification"
                onClick={() => setMessage("")}
              >
                ×
              </button>
            </div>
          )}
          {(view === "Overview" || view === "Reports") && (
            <>
              <div className="crm-section-heading">
                <span className="crm-muted">Reporting period · UTC</span>
                {dateControls}
              </div>
              <div className="crm-stats">
                {[
                  {
                    label: "New leads",
                    value: summary.newLeads,
                    note: "Created in selected period",
                    icon: "↗",
                  },
                  {
                    label: "Open pipeline",
                    value: money(summary.pipeline),
                    note: "All current open opportunities",
                    icon: "◫",
                  },
                  {
                    label: "Won deal value",
                    value: money(summary.wonValue),
                    note: `${summary.won} deals won in selected period`,
                    icon: "◎",
                  },
                  {
                    label: "Win rate",
                    value: summary.rate === null ? "—" : `${summary.rate}%`,
                    note: "Won ÷ closed deals in period",
                    icon: "↗",
                  },
                ].map((s, i) => (
                  <article className={`crm-stat stat-${i}`} key={s.label}>
                    <div>
                      <span>{s.label}</span>
                      <span className="stat-icon">{s.icon}</span>
                    </div>
                    <strong>{s.value}</strong>
                    <small>{s.note}</small>
                  </article>
                ))}
              </div>
            </>
          )}
          {view === "Overview" && (
            <>
              <div className="crm-overview-grid">
                <section className="crm-panel">
                  <div className="crm-panel-heading">
                    <div>
                      <h2>Your pipeline</h2>
                      <p>From first hello to a signed deal.</p>
                    </div>
                    <button onClick={() => changeView("Leads")}>
                      View pipeline ↗
                    </button>
                  </div>
                  <div className="crm-pipeline-chart">
                    {stages
                      .filter((s) => s.kind === "open")
                      .map((s, i) => {
                        const count = data.leads.filter(
                          (l) => l.stage_id === s.id,
                        ).length;
                        const max = Math.max(
                          1,
                          ...stages.map(
                            (stage) =>
                              data.leads.filter((l) => l.stage_id === stage.id)
                                .length,
                          ),
                        );
                        return (
                          <div className="chart-column" key={s.id}>
                            <span>{count}</span>
                            <div className="chart-bar-space">
                              <div
                                className={`chart-bar bar-${i % 4}`}
                                style={{
                                  height: `${Math.max(3, (count / max) * 100)}%`,
                                }}
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
                      {
                        data.leads.filter((l) => stageOf(l)?.kind === "open")
                          .length
                      }{" "}
                      leads in motion
                    </strong>
                  </div>
                </section>
                <section className="crm-panel">
                  <div className="crm-panel-heading">
                    <div>
                      <h2>
                        Needs your attention{" "}
                        <span className="crm-count">
                          {overdue.length + dueLeads.length}
                        </span>
                      </h2>
                      <p>The next steps that matter.</p>
                    </div>
                  </div>
                  <div className="crm-attention">
                    {[
                      ...overdue.map((t) => ({
                        id: t.id,
                        title: t.title,
                        lead: t.lead_id,
                        due: t.due_at,
                      })),
                      ...dueLeads.map((l) => ({
                        id: l.id,
                        title: `Follow up with ${l.name}`,
                        lead: l.id,
                        due: l.follow_up!,
                      })),
                    ]
                      .slice(0, 4)
                      .map((t) => (
                        <button key={t.id} onClick={() => setSelected(t.lead)}>
                          <span className="attention-icon">↗</span>
                          <span>
                            <strong>{t.title}</strong>
                            <small>
                              {data.leads.find((l) => l.id === t.lead)
                                ?.company || "Lead follow-up"}
                            </small>
                          </span>
                          <em>{dateLabel(t.due)}</em>
                        </button>
                      ))}
                    {!overdue.length && !dueLeads.length && (
                      <div className="crm-empty">
                        <h3>You’re all caught up.</h3>
                        <p>
                          Your overdue tasks and lead follow-ups will appear
                          here.
                        </p>
                      </div>
                    )}
                  </div>
                  <button
                    className="crm-panel-footer"
                    onClick={() => changeView("Follow-ups")}
                  >
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
                  <button onClick={() => changeView("Leads")}>
                    All leads ↗
                  </button>
                </div>
                {leadTable(
                  [...data.leads]
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .slice(0, 5),
                )}
              </section>
            </>
          )}
          {view === "Leads" && (
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
                  {[
                    ...new Set(data.leads.map((l) => l.source).filter(Boolean)),
                  ].map((s) => (
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
                          stage: stageOf(l)?.name,
                          owner:
                            data.members.find((m) => m.id === l.owner_id)
                              ?.name || "Unassigned",
                        })),
                        [
                          ...csvHeaders,
                          "stage",
                          "owner",
                          "follow_up",
                          "created_at",
                          "closed_at",
                          "client_id",
                        ],
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
                      if (f.size > 2_000_000)
                        throw new Error("CSV must be smaller than 2 MB.");
                      const rows = parseCsv(await f.text());
                      if (!rows.length)
                        throw new Error("CSV has no leads to import.");
                      setImportRows(rows);
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Unable to read CSV.",
                      );
                    }
                  }}
                />
              </div>
              <div className="crm-section-heading">
                <span className="crm-muted">
                  {filtered.length} opportunities ·{" "}
                  {money(
                    filtered
                      .filter((l) => stageOf(l)?.kind === "open")
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
                                  s.kind === "lost"
                                    ? "var(--color-mute)"
                                    : "var(--color-primary)",
                              }}
                            />
                            {s.name}
                            <b>{rows.length}</b>
                          </span>
                          <small>
                            {money(rows.reduce((sum, l) => sum + l.value, 0))}
                          </small>
                        </div>
                        {rows.map((l) => (
                          <article
                            draggable={!busy && !l.client_id}
                            onDragStart={(e) =>
                              e.dataTransfer.setData("text/plain", l.id)
                            }
                            className="crm-lead-card"
                            key={l.id}
                          >
                            <button
                              className="card-title"
                              onClick={() => setSelected(l.id)}
                            >
                              <span className="crm-avatar">
                                {initials(l.name)}
                              </span>
                              <span>
                                <strong>{l.name}</strong>
                                <small>{l.company || "Individual"}</small>
                              </span>
                              <span>↗</span>
                            </button>
                            <p>{l.service || "Service to be discussed"}</p>
                            <strong className="card-value">
                              {money(l.value)}
                            </strong>
                            <div className="card-bottom">
                              <span>{l.source || "Manual"}</span>
                              <span
                                className={
                                  l.follow_up &&
                                  Date.parse(l.follow_up) < now &&
                                  s.kind === "open"
                                    ? "crm-overdue"
                                    : ""
                                }
                              >
                                {l.follow_up
                                  ? `◷ ${dateLabel(l.follow_up)}`
                                  : "No follow-up"}
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
                <section className="crm-panel">{leadTable(filtered)}</section>
              )}
            </>
          )}
          {view === "Clients" && (
            <section className="crm-panel">
              <div className="crm-panel-heading">
                <h2>{data.clients.length} client relationships</h2>
                <button
                  onClick={() =>
                    download(
                      "veyrn-clients.csv",
                      exportCsv(data.clients, [
                        "name",
                        "company",
                        "email",
                        "phone",
                        "created_at",
                      ]),
                    )
                  }
                >
                  ↓ Export clients
                </button>
              </div>
              {!data.clients.length ? (
                <div className="crm-empty">
                  <span className="empty-symbol">♧</span>
                  <h3>Your next client starts with a lead.</h3>
                  <p>
                    Open a lead and select “Convert to client” to bring its
                    history along.
                  </p>
                  <button onClick={() => changeView("Leads")}>
                    Explore your leads →
                  </button>
                </div>
              ) : (
                <div className="crm-client-grid">
                  {data.clients.map((c) => (
                    <article key={c.id}>
                      <span className="crm-avatar">{initials(c.name)}</span>
                      <h3>{c.company || c.name}</h3>
                      <p>{c.name}</p>
                      <p>{c.email || "No email added"}</p>
                      <small>Client since {dateLabel(c.created_at)}</small>
                      {data.leads
                        .filter((l) => l.client_id === c.id)
                        .map((l) => (
                          <button key={l.id} onClick={() => setSelected(l.id)}>
                            {l.service || "View lead history"} ↗
                          </button>
                        ))}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          {view === "Follow-ups" && (
            <div className="crm-overview-grid">
              <section className="crm-panel">
                <div className="crm-panel-heading">
                  <div>
                    <h2>Lead follow-ups</h2>
                    <p>Open leads with a scheduled next step.</p>
                  </div>
                </div>
                {data.leads
                  .filter((l) => l.follow_up && stageOf(l)?.kind === "open")
                  .sort((a, b) => a.follow_up!.localeCompare(b.follow_up!))
                  .map((l) => (
                    <button
                      className="crm-follow-row"
                      key={l.id}
                      onClick={() => setSelected(l.id)}
                    >
                      <span className="crm-avatar">{initials(l.name)}</span>
                      <span>
                        <strong>{l.name}</strong>
                        <small>{l.company}</small>
                      </span>
                      <span
                        className={
                          Date.parse(l.follow_up!) < now ? "crm-overdue" : ""
                        }
                      >
                        {datetime(l.follow_up!)}
                      </span>
                    </button>
                  ))}
                {!data.leads.some(
                  (l) => l.follow_up && stageOf(l)?.kind === "open",
                ) && (
                  <div className="crm-empty">
                    Schedule a follow-up from any lead.
                  </div>
                )}
              </section>
              <section className="crm-panel">
                <div className="crm-panel-heading">
                  <div>
                    <h2>Tasks</h2>
                    <p>Check off a next step when it’s done.</p>
                  </div>
                </div>
                {[...data.tasks]
                  .sort(
                    (a, b) =>
                      Number(a.completed) - Number(b.completed) ||
                      a.due_at.localeCompare(b.due_at),
                  )
                  .map((t) => (
                    <div className="crm-task-row" key={t.id}>
                      <input
                        type="checkbox"
                        aria-label={`Complete ${t.title}`}
                        checked={t.completed}
                        disabled={busy}
                        onChange={(e) =>
                          void mutate({
                            action: "completeTask",
                            id: t.id,
                            completed: e.target.checked,
                          })
                        }
                      />
                      <button onClick={() => setSelected(t.lead_id)}>
                        <strong
                          style={{
                            textDecoration: t.completed
                              ? "line-through"
                              : "none",
                          }}
                        >
                          {t.title}
                        </strong>
                        <small
                          className={
                            !t.completed && Date.parse(t.due_at) < now
                              ? "crm-overdue"
                              : ""
                          }
                        >
                          {datetime(t.due_at)} ·{" "}
                          {data.leads.find((l) => l.id === t.lead_id)?.name}
                        </small>
                      </button>
                    </div>
                  ))}
                {!data.tasks.length && (
                  <div className="crm-empty">
                    Open a lead to add its first task.
                  </div>
                )}
              </section>
            </div>
          )}
          {view === "Reports" && (
            <section className="crm-panel">
              <div className="crm-panel-heading">
                <div>
                  <h2>Where your opportunities come from</h2>
                  <p>
                    New leads use creation date; won and lost deals use closing
                    date. All values are INR.
                  </p>
                </div>
              </div>
              <div className="crm-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>New leads</th>
                      <th>Open pipeline · all time</th>
                      <th>Won deals</th>
                      <th>Won value</th>
                      <th>Win rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...new Set(data.leads.map((l) => l.source || "Manual")),
                    ].map((s) => {
                      const stats = metrics(
                        {
                          ...data,
                          leads: data.leads.filter(
                            (l) => (l.source || "Manual") === s,
                          ),
                        },
                        from,
                        to,
                      );
                      return (
                        <tr key={s}>
                          <td>{s}</td>
                          <td>{stats.newLeads}</td>
                          <td>{money(stats.pipeline)}</td>
                          <td>{stats.won}</td>
                          <td>{money(stats.wonValue)}</td>
                          <td>
                            {stats.rate === null ? "—" : `${stats.rate}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="crm-chart-footer">
                Won value represents signed deals, not collected payments.
                Reports cover records you can access.
              </div>
            </section>
          )}
          {view === "Settings" && (
            <div className="crm-overview-grid">
              <section className="crm-panel">
                <div className="crm-panel-heading">
                  <div>
                    <h2>Pipeline stages</h2>
                    <p>
                      Rename stages and set their display order. Won/lost
                      meanings are fixed.
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
                <section className="crm-panel">
                  <div className="crm-panel-heading">
                    <div>
                      <h2>Your team</h2>
                      <p>
                        Owners and admins see all leads; team members see
                        assigned leads.
                      </p>
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
                    Account provisioning and role changes are managed by the
                    workspace owner in Supabase for this release.
                  </div>
                </section>
                <section className="crm-panel crm-export-panel">
                  <h2>Take your data with you</h2>
                  <p>
                    Download all records available to your account, including
                    history and tasks.
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
          )}
          <footer className="crm-content-footer">
            <span>Veyrn Labs Workspace</span>
            <span>A little structure. A lot of possibility.</span>
          </footer>
        </main>
      </div>
      <dialog
        ref={dialog}
        className="crm-dialog"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="crm-dialog-inner">
          <button
            className="dialog-close"
            aria-label="Close dialog"
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
          {error && (
            <p role="alert" className="crm-error">
              {error}
            </p>
          )}
          {editing ? (
            <LeadForm
              key={editing === "new" ? "new" : editing.id}
              lead={editing === "new" ? undefined : editing}
              defaultStage={newStage}
              data={data}
              busy={busy}
              save={async (values) => {
                if (
                  await mutate({
                    action: "saveLead",
                    id: editing === "new" ? undefined : editing.id,
                    lead: values,
                  })
                ) {
                  setEditing(null);
                  setNewStage(undefined);
                }
              }}
            />
          ) : importRows ? (
            <>
              <Eyebrow>CSV IMPORT</Eyebrow>
              <h2>Review {importRows.length} leads</h2>
              <p>
                All rows were validated. Leads start in the first open stage.
                Existing contacts are not merged automatically.
              </p>
              <div className="crm-import-preview">
                {importRows.slice(0, 10).map((r, i) => (
                  <p key={i}>
                    <strong>{String(r.name)}</strong> ·{" "}
                    {String(r.company || r.email || "Individual")}
                  </p>
                ))}
                {importRows.length > 10 && (
                  <p>And {importRows.length - 10} more…</p>
                )}
              </div>
              <button
                className="crm-primary"
                disabled={busy}
                onClick={async () => {
                  if (await mutate({ action: "import", rows: importRows }))
                    setImportRows(null);
                }}
              >
                {busy ? "Importing…" : `Import ${importRows.length} leads`}
              </button>
            </>
          ) : current ? (
            <>
              <Eyebrow>LEAD DETAILS</Eyebrow>
              <h2>{current.name}</h2>
              <p>
                {current.company} {current.service && `· ${current.service}`}
              </p>
              <div className="crm-detail-actions">
                <button onClick={() => setEditing(current)}>
                  Edit details
                </button>
                <button
                  className="crm-primary"
                  disabled={busy || !!current.client_id}
                  onClick={() =>
                    void mutate({ action: "convert", id: current.id })
                  }
                >
                  {current.client_id
                    ? "✓ Converted to client"
                    : "Convert to client ↗"}
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
                    disabled={busy || !!current.client_id}
                    onChange={(e) =>
                      void mutate({
                        action: "stage",
                        id: current.id,
                        stage_id: e.target.value,
                      })
                    }
                  >
                    {stages.map((s) => (
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
                  <dd>
                    {data.members.find((m) => m.id === current.owner_id)
                      ?.name || "Unassigned"}
                  </dd>
                </div>
                <div>
                  <dt>Next follow-up</dt>
                  <dd>
                    {current.follow_up
                      ? datetime(current.follow_up)
                      : "Not scheduled"}
                  </dd>
                </div>
              </dl>
              {current.notes && (
                <div className="crm-notes">{current.notes}</div>
              )}
              <h3>Add an activity</h3>
              <form
                className="crm-activity-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  if (
                    await mutate({
                      action: "activity",
                      id: current.id,
                      ...Object.fromEntries(f),
                    })
                  )
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
                <input
                  name="due_at"
                  aria-label="Task due date and time"
                  type="datetime-local"
                  required
                />
                <button disabled={busy}>Add task</button>
              </form>
              {data.tasks
                .filter((t) => t.lead_id === current.id)
                .map((t) => (
                  <label className="crm-inline-task" key={t.id}>
                    <input
                      type="checkbox"
                      checked={t.completed}
                      disabled={busy}
                      onChange={(e) =>
                        void mutate({
                          action: "completeTask",
                          id: t.id,
                          completed: e.target.checked,
                        })
                      }
                    />
                    {t.title}
                    <small>{datetime(t.due_at)}</small>
                  </label>
                ))}
              <h3>Activity history</h3>
              <div className="crm-timeline">
                {sortedActivity
                  .filter((a) => a.lead_id === current.id)
                  .map((a) => (
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
          ) : null}
        </div>
      </dialog>
    </div>
  );
}

function LeadForm({
  lead,
  defaultStage,
  data,
  busy,
  save,
}: {
  lead?: Lead;
  defaultStage?: string;
  data: Data;
  busy: boolean;
  save: (values: Record<string, unknown>) => Promise<void>;
}) {
  const localTime = lead?.follow_up
    ? new Date(
        Date.parse(lead.follow_up) -
          new Date(lead.follow_up).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
  return (
    <>
      <Eyebrow>
        {lead ? "KEEP THE DETAILS CURRENT" : "A NEW POSSIBILITY"}
      </Eyebrow>
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
            follow_up: values.follow_up
              ? new Date(String(values.follow_up)).toISOString()
              : null,
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
              {[
                "Website",
                "Referral",
                "LinkedIn",
                "Outbound",
                "Instagram",
                "Manual",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </datalist>
          </label>
          <label>
            Owner
            <select
              name="owner_id"
              defaultValue={
                lead?.owner_id ||
                (data.user.role === "team" ? data.user.id : "")
              }
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
                [...data.stages]
                  .filter((s) => s.kind === "open")
                  .sort((a, b) => a.position - b.position)[0]?.id
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
            <input
              name="follow_up"
              type="datetime-local"
              defaultValue={localTime}
            />
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
        <button className="crm-primary" disabled={busy}>
          {busy ? "Saving…" : lead ? "Save changes" : "Create lead →"}
        </button>
      </form>
    </>
  );
}
function StageForm({
  stage,
  disabled,
  save,
}: {
  stage?: Stage;
  disabled: boolean;
  save: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <form
      className="crm-stage-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        if (
          (await save({
            action: "saveStage",
            id: stage?.id,
            name: f.get("name"),
            position: Number(f.get("position")),
          })) &&
          !stage
        )
          form.reset();
      }}
    >
      <input
        aria-label={stage ? `Stage name: ${stage.name}` : "New stage name"}
        name="name"
        required
        maxLength={60}
        defaultValue={stage?.name}
        placeholder="New stage name"
        disabled={disabled}
      />
      <input
        aria-label="Stage position"
        name="position"
        type="number"
        min={0}
        max={1000}
        required
        defaultValue={stage?.position ?? 5}
        disabled={disabled}
      />
      <button disabled={disabled}>{stage ? "Save" : "Add"}</button>
    </form>
  );
}
