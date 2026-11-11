"use client";
import { Fragment, useMemo, useState } from "react";
import { Logo } from "@/components/Logo";
import { download } from "./download";
import { CreateCustomer, WorkspaceGrants, type Grant } from "./PlanGrants";

type Workspace = {
  id: string;
  name: string;
  created_at: string;
  owner_name: string | null;
  owner_email: string | null;
  members: number;
  purchased_seats: number;
  plan: "pro" | "pro_plus" | null;
  billing_months: number | null;
  paying: boolean;
  paid_until: string | null;
  billing_status: string | null;
  // Missing until the plan grants migration is applied.
  grants?: Grant[];
  monthly_paise: number;
  leads: number;
  leads_7d: number;
  clients: number;
  whatsapp_provider: "meta" | "gupshup" | null;
  whatsapp_active: boolean;
  messages_in_30d: number;
  messages_out_30d: number;
  followups_30d: number;
  last_activity: string | null;
};
export type Overview = {
  generated_at: string;
  totals: {
    workspaces: number;
    new_30d: number;
    paying: number;
    mrr_paise: number;
    members: number;
    leads: number;
    leads_7d: number;
    whatsapp_connected: number;
    messages_in_30d: number;
    messages_out_30d: number;
    followups_30d: number;
  };
  health: {
    workers: { id: string; last_seen: string; last_success: string | null; last_error: string | null }[];
    billing_problems: number;
    followups_need_attention: number;
    unconfirmed_messages: number;
  };
  workspaces: Workspace[];
};

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const number = (n: number) => n.toLocaleString("en-IN");
const PLAN: Record<string, string> = { pro: "Pro", pro_plus: "Pro Plus" };
const PERIOD: Record<number, string> = { 1: "monthly", 3: "quarterly", 12: "annual" };
const WORKER: Record<string, string> = {
  "whatsapp-followups": "WhatsApp follow-ups",
  followups: "Email follow-ups (AI)",
  replies: "AI auto-replies",
};
// Relative to when the overview was generated (not Date.now()), so the server render and the
// browser's hydration produce identical text.
function ago(iso: string | null, now: number) {
  if (!iso) return "—";
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
// The grant giving access right now, if any.
const liveGrant = (w: Workspace, now: number) =>
  w.grants?.find((g) => Date.parse(g.starts_at) <= now && Date.parse(g.ends_at) > now);
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";

type Filter = "all" | "paying" | "granted" | "free" | "whatsapp" | "inactive";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "paying", label: "Paying" },
  { id: "granted", label: "Granted" },
  { id: "free", label: "Free" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "inactive", label: "Quiet 14+ days" },
];

export function PlatformAdmin({ overview, email }: { overview: Overview; email: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const { totals, health } = overview;
  const now = Date.parse(overview.generated_at);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return overview.workspaces.filter((w) => {
      if (q && ![w.name, w.owner_name, w.owner_email].some((v) => v?.toLowerCase().includes(q))) return false;
      if (filter === "paying") return w.paying;
      if (filter === "granted") return !!liveGrant(w, now);
      if (filter === "free") return !w.paying && !liveGrant(w, now);
      if (filter === "whatsapp") return w.whatsapp_active;
      if (filter === "inactive")
        return !w.last_activity || now - Date.parse(w.last_activity) > 14 * 86400e3;
      return true;
    });
  }, [overview.workspaces, query, filter, now]);
  // Workers poll every minute; anything quieter than 10 minutes, or reporting an error, is flagged.
  const workerOk = (w: Overview["health"]["workers"][number]) =>
    !w.last_error && now - Date.parse(w.last_seen) < 10 * 60000;
  const problems = [
    health.billing_problems && `${health.billing_problems} payment${health.billing_problems === 1 ? "" : "s"} retrying or failed`,
    health.followups_need_attention && `${health.followups_need_attention} follow-up${health.followups_need_attention === 1 ? "" : "s"} need attention (7 days)`,
    health.unconfirmed_messages && `${health.unconfirmed_messages} message${health.unconfirmed_messages === 1 ? "" : "s"} with unconfirmed delivery`,
  ].filter(Boolean) as string[];

  const stats = [
    { label: "Customers", value: number(totals.workspaces), note: `${number(totals.new_30d)} new in 30 days` },
    { label: "Paying", value: number(totals.paying), note: `${totals.workspaces ? Math.round((totals.paying / totals.workspaces) * 100) : 0}% of customers` },
    { label: "Monthly revenue", value: rupees(totals.mrr_paise), note: "Plans + seats, GST excluded" },
    { label: "Leads", value: number(totals.leads), note: `${number(totals.leads_7d)} added in 7 days` },
    { label: "WhatsApp connected", value: number(totals.whatsapp_connected), note: `${number(totals.messages_in_30d)} in · ${number(totals.messages_out_30d)} out (30 days)` },
    { label: "Auto follow-ups", value: number(totals.followups_30d), note: "Sent in 30 days" },
  ];

  return (
    <main className="crm-admin">
      <header className="crm-admin-top">
        <Logo href="/crm" />
        <div>
          <span className="crm-eyebrow">Platform admin</span>
          <small>
            {email} · updated {new Date(overview.generated_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST
          </small>
        </div>
        <a className="crm-admin-link" href="/crm">← Back to workspace</a>
      </header>

      <section className="crm-admin-stats">
        {stats.map((s) => (
          <article key={s.label}>
            <small>{s.label}</small>
            <strong>{s.value}</strong>
            <span>{s.note}</span>
          </article>
        ))}
      </section>

      <section className="crm-admin-health">
        <div>
          <h2>Health</h2>
          <ul>
            {health.workers.map((w) => (
              <li key={w.id}>
                <span className={workerOk(w) ? "crm-dot ok" : "crm-dot bad"} aria-hidden="true" />
                <strong>{WORKER[w.id] ?? w.id}</strong>
                <small>
                  {w.last_error ? w.last_error : `last run ${ago(w.last_seen, now)}`}
                </small>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Needs attention</h2>
          {problems.length ? (
            <ul>
              {problems.map((p) => (
                <li key={p}>
                  <span className="crm-dot bad" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            <p className="crm-muted">Nothing right now.</p>
          )}
        </div>
      </section>

      <CreateCustomer />

      <section className="crm-panel crm-admin-table">
        <div className="crm-panel-heading">
          <div>
            <h2>Customers</h2>
            <p>
              {rows.length} of {overview.workspaces.length} workspaces
            </p>
          </div>
          <div className="crm-admin-tools">
            <div className="crm-period-toggle" role="group" aria-label="Filter">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or owner…"
              aria-label="Search customers"
            />
            <button
              type="button"
              onClick={() =>
                download(
                  "veyrn-customers.csv",
                  [
                    "workspace,owner,email,plan,paying,monthly_inr,members,leads,whatsapp,created",
                    ...rows.map((w) =>
                      [w.name, w.owner_name ?? "", w.owner_email ?? "", w.plan ?? "free", w.paying, Math.round(w.monthly_paise / 100), w.members, w.leads, w.whatsapp_active ? w.whatsapp_provider : "", w.created_at.slice(0, 10)]
                        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                        .join(","),
                    ),
                  ].join("\n"),
                  "text/csv",
                )
              }
            >
              ↓ Export
            </button>
          </div>
        </div>
        <div className="crm-admin-scroll">
          <table>
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Plan</th>
                <th className="num">Monthly</th>
                <th className="num">Users</th>
                <th className="num">Leads</th>
                <th>WhatsApp</th>
                <th>Last active</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <Fragment key={w.id}>
                  <tr className={open === w.id ? "is-open" : undefined} onClick={() => setOpen(open === w.id ? null : w.id)}>
                    <td>
                      <button type="button" className="crm-admin-name" aria-expanded={open === w.id}>
                        <strong>{w.name}</strong>
                        <small>{w.owner_email ?? "No owner"}</small>
                      </button>
                    </td>
                    <td>
                      {w.paying ? (
                        <span className="crm-badge won">{PLAN[w.plan ?? ""] ?? "Paid"}</span>
                      ) : liveGrant(w, now) ? (
                        <span className="crm-badge" title={`Granted until ${date(liveGrant(w, now)!.ends_at)}`}>
                          {PLAN[liveGrant(w, now)!.plan]} · granted
                        </span>
                      ) : (
                        <span className="crm-badge">Free</span>
                      )}
                    </td>
                    <td className="num">{w.monthly_paise ? rupees(w.monthly_paise) : "—"}</td>
                    <td className="num">{w.members}</td>
                    <td className="num">
                      {number(w.leads)}
                      {w.leads_7d > 0 && <small> +{w.leads_7d}</small>}
                    </td>
                    <td>{w.whatsapp_active ? (w.whatsapp_provider === "gupshup" ? "Gupshup" : "Meta") : "—"}</td>
                    <td>{ago(w.last_activity, now)}</td>
                    <td>{date(w.created_at)}</td>
                  </tr>
                  {open === w.id && (
                    <tr className="crm-admin-detail">
                      <td colSpan={8}>
                        <dl>
                          <div><dt>Owner</dt><dd>{w.owner_name ?? "—"} · {w.owner_email ?? "—"}</dd></div>
                          <div><dt>Plan</dt><dd>{w.plan ? `${PLAN[w.plan]} · ${PERIOD[w.billing_months ?? 1] ?? ""}` : "None"}{w.billing_status ? ` · billing ${w.billing_status}` : ""}</dd></div>
                          <div><dt>Access until</dt><dd>{date(w.paid_until)}</dd></div>
                          <div><dt>Seats</dt><dd>{w.members} members · {w.purchased_seats} extra seats</dd></div>
                          <div><dt>Leads</dt><dd>{number(w.leads)} total · {w.leads_7d} this week · {w.clients} clients</dd></div>
                          <div><dt>WhatsApp (30 days)</dt><dd>{w.messages_in_30d} in · {w.messages_out_30d} out · {w.followups_30d} automatic follow-ups</dd></div>
                          <div><dt>Workspace ID</dt><dd><code>{w.id}</code></dd></div>
                        </dl>
                        {w.grants && <WorkspaceGrants organizationId={w.id} grants={w.grants} paidUntil={w.paid_until} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="crm-muted">No workspaces match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
