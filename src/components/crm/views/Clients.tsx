"use client";
import { download } from "../download";
import { exportCsv } from "@/lib/crm/model";
import { dateLabel, initials } from "@/lib/crm/workspace";
import { useWorkspaceContext } from "../context";

export function Clients() {
  const { data, setSelected, changeView } = useWorkspaceContext();
  return (
    <section className="crm-panel">
      <div className="crm-panel-heading">
        <h2>{data.clients.length} client relationships</h2>
        <button
          onClick={() =>
            download(
              "veyrn-clients.csv",
              exportCsv(data.clients, ["name", "company", "email", "phone", "created_at"]),
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
          <p>Open a lead and select “Convert to client” to bring its history along.</p>
          <button onClick={() => changeView("Leads")}>Explore your leads →</button>
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
  );
}
