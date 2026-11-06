"use client";
import { crmFetch } from "./activity";
import { useState } from "react";
type Invite = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};
export function TeamInvitations({
  role,
  demo,
  now,
}: {
  role: string;
  demo: boolean;
  now: number;
}) {
  const [items, setItems] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [loaded, setLoaded] = useState(false);
  async function load() {
    const res = await crmFetch("/api/crm/invitations");
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    setItems(result.invitations);
    setLoaded(true);
  }
  async function act(body?: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setLink("");
    try {
      if (body) {
        const res = await crmFetch("/api/crm/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        if (result.path)
          setLink(new URL(result.path, window.location.origin).href);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (role === "team") return null;
  return (
    <div className="crm-team-invite">
      <div className="crm-team-invite-head">
        <div>
          <h3>Invite a teammate</h3>
          <p className="crm-muted">
            Create a link for a specific email, then share it with that teammate.
            Links expire after seven days. No email is sent automatically.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || demo}
          onClick={() => void act()}
        >
          {loaded ? "Refresh" : "Show invitations"}
        </button>
      </div>
      <form
        className="crm-invite-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act({
            ...Object.fromEntries(new FormData(e.currentTarget)),
            action: "create",
          });
        }}
      >
        <label>
          Work email
          <input
            name="email"
            type="email"
            autoComplete="off"
            required
            maxLength={254}
          />
        </label>
        <label>
          Role
          <select name="role">
            <option value="team">Team member</option>
            {role === "owner" && <option value="admin">Admin</option>}
          </select>
        </label>
        <button className="crm-primary" aria-busy={busy} disabled={busy || demo}>
          {busy ? "Please wait…" : "Create link"}
        </button>
      </form>
      {demo && (
        <p className="crm-muted">Invitations are unavailable in sample mode.</p>
      )}
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {link && (
        <label className="crm-invite-link">
          Copy and share this link
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
        </label>
      )}
      {loaded && !items.length && (
        <p className="crm-muted">No invitations yet.</p>
      )}
      {items.length > 0 && (
      <ul className="crm-team-list">
      {items.map((item) => (
        <li key={item.id} className="crm-team-row">
          <span className="crm-team-name">
            <strong>{item.email}</strong>
            <small>
              {item.role === "admin" ? "Admin" : "Team member"} ·{" "}
              {item.accepted_at
                ? "Accepted"
                : item.revoked_at
                  ? "Revoked"
                  : new Date(item.expires_at).getTime() <= now
                    ? "Expired"
                    : "Pending"}
            </small>
          </span>
          {!item.accepted_at && !item.revoked_at && (
            <button
              disabled={busy}
              onClick={() => void act({ action: "revoke", id: item.id })}
            >
              Revoke
            </button>
          )}
        </li>
      ))}
      </ul>
      )}
    </div>
  );
}
