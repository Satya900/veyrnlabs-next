"use client";
import { useEffect, useState } from "react";
import { demoWorkspace } from "@/lib/crm/model";
import type { Workspace as Data } from "@/lib/crm/model";
import { applyChanges, demoMutate } from "@/lib/crm/workspace";
import type { WorkspaceChanges } from "@/lib/crm/workspace";

export function useWorkspaceData(demo: boolean, initialData: Data | null = null) {
  const [data, setData] = useState<Data | null>(initialData);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  async function reload() {
    const res = await fetch("/api/crm", { cache: "no-store" });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    setData(result);
    return result as Data;
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (demo) {
      Promise.resolve().then(() => {
        if (active) setData(demoWorkspace());
      });
    } else if (!initialData) {
      // No server-rendered data (e.g. the initial fetch failed): fall back
      // to fetching client-side instead of leaving the page stuck loading.
      fetch("/api/crm", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          if (active) setData(result);
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    }
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
    // initialData only seeds the first render; it must not re-trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  async function mutate(body: Record<string, unknown>) {
    if (!data || busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!demo) {
        const res = await fetch("/api/crm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        // The mutation response carries exactly what changed, so the
        // workspace can be patched in place instead of re-fetched whole.
        setData((current) =>
          current
            ? applyChanges(current, (result.changes ?? {}) as WorkspaceChanges)
            : current,
        );
      } else {
        setData(demoMutate(data, body));
      }
      setMessage(
        demo
          ? "Updated sample workspace. Demo changes reset when you reload."
          : "Saved to your workspace.",
      );
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to save. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * For interactions where waiting on a round trip would feel broken
   * (checkbox toggles, drag-and-drop): apply the expected result to local
   * state immediately, then reconcile with the server's actual response.
   * On failure, resync from the server rather than guessing a rollback.
   * Safe even if another mutation is in flight at the same time.
   */
  async function optimisticMutate(
    body: Record<string, unknown>,
    optimisticChanges: WorkspaceChanges,
  ) {
    if (!data) return false;
    setError("");
    setData((current) => (current ? applyChanges(current, optimisticChanges) : current));
    if (demo) {
      setData((current) => (current ? demoMutate(current, body) : current));
      return true;
    }
    try {
      const res = await fetch("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setData((current) =>
        current
          ? applyChanges(current, (result.changes ?? {}) as WorkspaceChanges)
          : current,
      );
      return true;
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "Unable to save.") +
          " Refreshing to show the current state.",
      );
      reload().catch(() => {});
      return false;
    }
  }

  return {
    data,
    error,
    message,
    busy,
    now,
    setError,
    setMessage,
    reload,
    mutate,
    optimisticMutate,
  };
}
