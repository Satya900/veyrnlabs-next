"use client";
import { useEffect, useState } from "react";
import { demoWorkspace } from "@/lib/crm/model";
import type { Workspace as Data } from "@/lib/crm/model";
import { demoMutate } from "@/lib/crm/workspace";

export function useWorkspaceData(demo: boolean) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  async function reload() {
    const res = await fetch("/api/crm", { cache: "no-store" });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    setData(result);
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (demo)
      Promise.resolve().then(() => {
        if (active) setData(demoWorkspace());
      });
    else
      fetch("/api/crm", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          if (active) setData(result);
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
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
        try {
          await reload();
        } catch {
          setError(
            "Your change was saved, but refreshing the workspace failed. Reload to see it; do not resubmit.",
          );
        }
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
  };
}
