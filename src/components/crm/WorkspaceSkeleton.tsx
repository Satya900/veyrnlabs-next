export function WorkspaceSkeleton() {
  return (
    <div className="crm-shell" aria-busy="true" aria-label="Loading your workspace">
      <aside className="crm-sidebar">
        <div className="crm-skeleton-logo" />
        <div className="crm-skeleton-line" style={{ width: 150, height: 44, marginBottom: 28 }} />
        <div className="crm-skeleton-nav">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="crm-skeleton-line" key={i} />
          ))}
        </div>
      </aside>
      <div className="crm-main">
        <header className="crm-topbar">
          <div className="crm-skeleton-line" style={{ width: 160, height: 14, marginBottom: 0 }} />
        </header>
        <main className="crm-content">
          <div className="crm-page-heading">
            <div>
              <div className="crm-skeleton-line" style={{ width: 120, height: 10 }} />
              <div className="crm-skeleton-line" style={{ width: 320, height: 40, marginTop: 16 }} />
            </div>
          </div>
          <div className="crm-stats">
            {Array.from({ length: 4 }).map((_, i) => (
              <div className="crm-stat crm-skeleton-card" key={i} />
            ))}
          </div>
          <div className="crm-overview-grid">
            <div className="crm-panel crm-skeleton-card" style={{ minHeight: 300 }} />
            <div className="crm-panel crm-skeleton-card" style={{ minHeight: 300 }} />
          </div>
        </main>
      </div>
    </div>
  );
}
