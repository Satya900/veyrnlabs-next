"use client";
import { useEffect, useState } from "react";

type Status = { connected: boolean; connected_at?: string };

export function CalendarSettings({ demo }: { demo: boolean; role: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("calendar_error") || "",
  );
  const [notice, setNotice] = useState(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("calendar") === "connected"
      ? "Google Calendar connected."
      : "",
  );

  async function load() {
    setBusy(true);
    try {
      const res = await fetch("/api/crm/calendar/status", { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setStatus(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load calendar status.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (demo) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("calendar") || params.has("calendar_error") || params.has("view")) {
      params.delete("calendar");
      params.delete("calendar_error");
      params.delete("view");
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (query ? `?${query}` : ""),
      );
    }
    Promise.resolve().then(() => void load());
  }, [demo]);

  async function disconnect() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/crm/calendar/status", { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="crm-panel">
      <div className="crm-panel-heading">
        <div>
          <h2>Site visit scheduling</h2>
          <p>Connect a Google Calendar to book real, conflict-free site visits.</p>
        </div>
      </div>
      <div className="crm-settings-body" aria-live="polite">
        {demo && <p>Calendar connection is available in your live workspace.</p>}
        {!demo && (
          <>
            {error && (
              <p role="alert" className="crm-error">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {status?.connected ? (
              <>
                <p>
                  Connected
                  {status.connected_at
                    ? ` since ${new Date(status.connected_at).toLocaleDateString("en-IN")}`
                    : ""}
                  .
                </p>
                <button type="button" disabled={busy} onClick={() => void disconnect()}>
                  Disconnect calendar
                </button>
              </>
            ) : (
              <>
                <p>
                  Not connected. Requires an active Pro Plus subscription; each
                  agent connects their own calendar.
                </p>
                <a className="crm-primary" href="/api/crm/calendar/connect">
                  Connect Google Calendar
                </a>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
