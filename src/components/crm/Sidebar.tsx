"use client";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import type { Member } from "@/lib/crm/model";
import { initials } from "@/lib/crm/workspace";
import { site } from "@/lib/site";
import type { View } from "./types";

const navigation: { name: View; icon: string }[] = [
  { name: "Overview", icon: "◫" },
  { name: "Leads", icon: "▤" },
  { name: "Clients", icon: "♧" },
  { name: "Follow-ups", icon: "◷" },
  { name: "Reports", icon: "▥" },
  { name: "Settings", icon: "⚙" },
];

export function Sidebar({
  view,
  changeView,
  overdueCount,
  user,
  demo,
  showReports,
  onAddLead,
  onSignOutError,
}: {
  view: View;
  changeView: (v: View) => void;
  overdueCount: number;
  user: Member;
  demo: boolean;
  showReports: boolean;
  onAddLead: () => void;
  onSignOutError: (message: string) => void;
}) {
  const router = useRouter();
  return (
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
        {navigation
          .filter((n) => n.name !== "Reports" || showReports)
          .map((n) => (
          <button
            key={n.name}
            aria-current={view === n.name ? "page" : undefined}
            onClick={() => changeView(n.name)}
          >
            <span aria-hidden="true">{n.icon}</span>
            {n.name}
            {n.name === "Follow-ups" && overdueCount > 0 && <b>{overdueCount}</b>}
          </button>
        ))}
      </nav>
      <div className="crm-sidebar-bottom">
        <div className="crm-sidebar-tip">
          <span>MAKE YOUR NEXT MOVE</span>
          <p>Every great project starts with a conversation.</p>
          <button onClick={onAddLead}>Add your next lead ↗</button>
        </div>
        <a className="crm-sidebar-support" href={`mailto:${site.email}`}>
          Need help? {site.email}
        </a>
        <div className="crm-profile">
          <span className="crm-avatar">{initials(user.name)}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{demo ? "Demo workspace" : `${user.role} · Veyrn Labs`}</small>
          </div>
          {!demo && (
            <button
              aria-label="Sign out"
              onClick={async () => {
                const res = await fetch("/api/crm/session", { method: "DELETE" });
                if (res.ok) {
                  router.push("/crm/login");
                  router.refresh();
                } else onSignOutError("Unable to sign out. Please try again.");
              }}
            >
              ↪
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
