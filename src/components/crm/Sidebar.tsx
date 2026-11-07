"use client";
import { crmFetch } from "./activity";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import type { Member } from "@/lib/crm/model";
import { initials } from "@/lib/crm/workspace";
import { site } from "@/lib/site";
import type { View } from "./types";

// 24px outline icons drawn on one grid so every nav item reads at the same weight.
const icons: Record<View | "signOut" | "chevron" | "check", React.ReactNode> = {
  Overview: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  Leads: <><rect x="3.5" y="4" width="5" height="16" rx="1.5" /><rect x="10.5" y="4" width="5" height="11" rx="1.5" /><rect x="17.5" y="4" width="3" height="7" rx="1.5" /></>,
  Clients: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c1.9.8 3.1 2.6 3.5 5.2" /></>,
  "Follow-ups": <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  WhatsApp: <path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.5-4.3a8.5 8.5 0 1 1 15.5-4.6Z" />,
  Reports: <><path d="M4 20h16" /><rect x="5.5" y="11" width="3" height="6" rx="1" /><rect x="10.5" y="6" width="3" height="11" rx="1" /><rect x="15.5" y="13" width="3" height="4" rx="1" /></>,
  Settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  chevron: <path d="M7 10l5 5 5-5" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  signOut: <><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H9" /><path d="M15 16l4-4-4-4M19 12H9" /></>,
};
function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg className="crm-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icons[name]}
    </svg>
  );
}
const navigation: View[] = ["Overview", "Leads", "Clients", "WhatsApp", "Follow-ups", "Reports", "Settings"];
const roleLabel: Record<string, string> = { owner: "Owner", admin: "Admin", team: "Team member" };

export function Sidebar({
  view,
  changeView,
  overdueCount,
  user,
  organizationName,
  organizationId,
  memberships = [],
  planLabel,
  demo,
  showReports,
  onAddLead,
  onSignOutError,
}: {
  view: View;
  changeView: (v: View) => void;
  overdueCount: number;
  user: Member;
  organizationName?: string;
  organizationId?: string;
  memberships?: { organization_id: string; organization_name: string; role: string }[];
  planLabel: string;
  demo: boolean;
  showReports: boolean;
  onAddLead: () => void;
  onSignOutError: (message: string) => void;
}) {
  const router = useRouter();
  const workspaceName = demo ? "Sample workspace" : organizationName || "Your workspace";
  const canSwitch = !demo && memberships.length > 1;
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState("");
  const switcher = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuItems = () =>
    Array.from(switcher.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!menuOpen) return;
    // Start on the current workspace so arrow keys move from there.
    const items = menuItems();
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
    const onPointer = (event: MouseEvent) => {
      if (!switcher.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [menuOpen]);
  function onMenuKey(event: React.KeyboardEvent) {
    const items = menuItems();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "Tab") closeMenu(false);
  }
  async function switchTo(organization: string) {
    if (organization === organizationId) return closeMenu(true);
    setSwitching(organization);
    try {
      const res = await crmFetch("/api/crm/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization }),
      });
      if (!res.ok) throw new Error();
      // A full load resets every view, filter and cache to the new business's data.
      window.location.reload();
    } catch {
      setSwitching("");
      closeMenu(true);
      onSignOutError("Couldn't switch workspace. Please try again.");
    }
  }
  const workspaceSummary = (
    <>
      <span className="crm-workspace-mark" aria-hidden="true">
        {initials(workspaceName)}
      </span>
      <div>
        <strong>{workspaceName}</strong>
        <small>{demo ? "Demo data" : planLabel}</small>
      </div>
    </>
  );
  return (
    <aside className="crm-sidebar">
      <Logo href="/" />
      {canSwitch ? (
        <div className="crm-workspace-switch" ref={switcher}>
          <button
            ref={trigger}
            type="button"
            className="crm-workspace-name"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && !menuOpen) {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
          >
            {workspaceSummary}
            <Icon name="chevron" />
          </button>
          {menuOpen && (
            <div className="crm-workspace-menu" role="menu" aria-label="Switch workspace" onKeyDown={onMenuKey}>
              <span className="crm-nav-label">Your workspaces</span>
              {memberships.map((m) => (
                <button
                  key={m.organization_id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={m.organization_id === organizationId}
                  aria-busy={switching === m.organization_id}
                  disabled={!!switching}
                  onClick={() => void switchTo(m.organization_id)}
                >
                  <span className="crm-workspace-mark" aria-hidden="true">
                    {initials(m.organization_name)}
                  </span>
                  <span>
                    <strong>{m.organization_name}</strong>
                    <small>{roleLabel[m.role] ?? m.role}</small>
                  </span>
                  {m.organization_id === organizationId && <Icon name="check" />}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="crm-workspace-name">{workspaceSummary}</div>
      )}
      <span className="crm-nav-label">WORKSPACE</span>
      <nav aria-label="CRM navigation">
        {navigation
          .filter((name) => name !== "Reports" || showReports)
          .map((name) => (
            <button
              key={name}
              aria-current={view === name ? "page" : undefined}
              onClick={() => changeView(name)}
            >
              <Icon name={name} />
              {name}
              {name === "Follow-ups" && overdueCount > 0 && (
                <b aria-label={`${overdueCount} overdue`}>{overdueCount}</b>
              )}
            </button>
          ))}
      </nav>
      <div className="crm-sidebar-bottom">
        <div className="crm-sidebar-tip">
          <p>Every deal starts with a conversation.</p>
          <button onClick={onAddLead}>+ Add a lead</button>
        </div>
        <a className="crm-sidebar-support" href={`mailto:${site.email}`}>
          <span>Need help?</span>
          {site.email}
        </a>
        <div className="crm-profile">
          <span className="crm-avatar">{initials(user.name)}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{demo ? "Demo workspace" : roleLabel[user.role] ?? user.role}</small>
          </div>
          {!demo && (
            <button
              aria-label="Sign out"
              onClick={async () => {
                const res = await crmFetch("/api/crm/session", { method: "DELETE" });
                if (res.ok) {
                  router.push("/crm/login");
                  router.refresh();
                } else onSignOutError("Unable to sign out. Please try again.");
              }}
            >
              <Icon name="signOut" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
