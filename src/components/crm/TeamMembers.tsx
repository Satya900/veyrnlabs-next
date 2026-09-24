"use client";
import { useState } from "react";
import { initials } from "@/lib/crm/workspace";
import type { Member } from "@/lib/crm/model";

export function TeamMembers({
  members,
  role,
  selfId,
  demo,
  reload,
}: {
  members: Member[];
  role: string;
  selfId: string;
  demo: boolean;
  reload: () => Promise<unknown>;
}) {
  const [pending, setPending] = useState<
    { id: string; action: "remove" | "transfer" } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/crm/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setPending(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const canRemove = (m: Member) =>
    m.role !== "owner" &&
    m.id !== selfId &&
    (role === "owner" || (role === "admin" && m.role === "team"));
  const target = members.find((m) => m.id === pending?.id);
  return (
    <>
      {members.map((m) => (
        <div key={m.id} className="crm-follow-row">
          <span className="crm-avatar">{initials(m.name)}</span>
          <strong>{m.name}</strong>
          <span className="crm-badge">{m.role}</span>
          {!demo && role === "owner" && m.role !== "owner" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending({ id: m.id, action: "transfer" })}
            >
              Make owner
            </button>
          )}
          {!demo && canRemove(m) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending({ id: m.id, action: "remove" })}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {pending && target && (
        <div className="crm-notice">
          {pending.action === "transfer"
            ? `Make ${target.name} the owner? You will become an admin.`
            : `Remove ${target.name} from this workspace? Their assigned leads and clients become unassigned.`}
          <button type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? "Please wait…" : "Confirm"}
          </button>
          <button type="button" disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
    </>
  );
}
