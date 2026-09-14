import Link from "next/link";
import type { Member } from "@/lib/crm/model";
import { initials } from "@/lib/crm/workspace";
import type { View } from "./types";

export function Topbar({
  view,
  demo,
  user,
}: {
  view: View;
  demo: boolean;
  user: Member;
}) {
  return (
    <>
      <header className="crm-topbar">
        <span>
          Workspace <span className="crm-slash">/</span> <strong>{view}</strong>
        </span>
        <div>
          <span className="crm-status-dot" />
          {demo ? "Sample workspace" : "Connected workspace"}
          <span className="crm-avatar small">{initials(user.name)}</span>
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
    </>
  );
}
