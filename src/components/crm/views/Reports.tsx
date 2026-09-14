"use client";
import { metrics, money } from "@/lib/crm/model";
import { useWorkspaceContext } from "../context";

export function Reports({ from, to }: { from: string; to: string }) {
  const { data } = useWorkspaceContext();
  const sources = [...new Set(data.leads.map((l) => l.source || "Manual"))];
  return (
    <section className="crm-panel">
      <div className="crm-panel-heading">
        <div>
          <h2>Where your opportunities come from</h2>
          <p>
            New leads use creation date; won and lost deals use closing date. All
            values are INR.
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
            {sources.map((s) => {
              const stats = metrics(
                { ...data, leads: data.leads.filter((l) => (l.source || "Manual") === s) },
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
                  <td>{stats.rate === null ? "—" : `${stats.rate}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="crm-chart-footer">
        Won value represents signed deals, not collected payments. Reports cover
        records you can access.
      </div>
    </section>
  );
}
