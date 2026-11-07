"use client";
import { useState } from "react";
import { download } from "../download";
import { exportCsv, money } from "@/lib/crm/model";
import { dateLabel, initials } from "@/lib/crm/workspace";
import { useWorkspaceContext } from "../context";

export function Clients() {
  const { data, setSelected, changeView } = useWorkspaceContext();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const clients = data.clients.filter(
    (c) => !q || [c.name, c.company, c.email, c.phone].some((v) => v?.toLowerCase().includes(q)),
  );
  const count = data.clients.length;
  return (
    <section className="crm-panel">
      <div className="crm-panel-heading crm-clients-heading">
        <div>
          <h2>
            {count} {count === 1 ? "client" : "clients"}
          </h2>
          <p>Leads you&apos;ve converted, with their deals and history.</p>
        </div>
        <div className="crm-clients-tools">
          {count > 0 && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients…"
              aria-label="Search clients"
            />
          )}
          <button
            onClick={() =>
              download(
                "veyrn-clients.csv",
                exportCsv(data.clients, ["name", "company", "email", "phone", "created_at"]),
              )
            }
            disabled={!count}
          >
            ↓ Export
          </button>
        </div>
      </div>
      {!count ? (
        <div className="crm-empty">
          <span className="empty-symbol">♧</span>
          <h3>Your next client starts with a lead.</h3>
          <p>Open a lead and select “Convert to client” to bring its history along.</p>
          <button onClick={() => changeView("Leads")}>Explore your leads →</button>
        </div>
      ) : !clients.length ? (
        <p className="crm-empty">No clients match “{query}”.</p>
      ) : (
        <div className="crm-client-grid">
          {clients.map((c) => {
            const deals = data.leads.filter((l) => l.client_id === c.id);
            const value = deals.reduce((sum, l) => sum + (l.value || 0), 0);
            const agent = data.members.find((m) => m.id === c.owner_id)?.name;
            return (
              <article key={c.id} className="crm-client-card">
                <header>
                  <span className="crm-avatar">{initials(c.company || c.name)}</span>
                  <div>
                    <h3>{c.company || c.name}</h3>
                    <p>{c.company ? c.name : "Individual"}</p>
                  </div>
                </header>
                <dl>
                  <div>
                    <dt>Email</dt>
                    <dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span>Not added</span>}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : <span>Not added</span>}</dd>
                  </div>
                  <div>
                    <dt>Agent</dt>
                    <dd>{agent ?? <span>Unassigned</span>}</dd>
                  </div>
                  <div>
                    <dt>Deals</dt>
                    <dd>
                      {deals.length} · {money(value)}
                    </dd>
                  </div>
                </dl>
                <footer>
                  <small>Client since {dateLabel(c.created_at)}</small>
                  {deals.length > 0 && (
                    <div className="crm-client-deals">
                      {deals.map((l) => (
                        <button key={l.id} type="button" onClick={() => setSelected(l.id)}>
                          {l.service || "View history"} ↗
                        </button>
                      ))}
                    </div>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
