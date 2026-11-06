"use client";
import { useSyncExternalStore } from "react";

// Counts CRM requests in flight so one shared indicator (ActivityBar) can show that the
// server is working, without every component wiring its own busy flag into a global.
let pending = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

// The workspace this tab is showing. Sent with every CRM request so a tab keeps acting in
// the business it displays even after another tab switches workspace.
let workspace: string | undefined;
export function setCrmWorkspace(id: string | undefined) {
  workspace = id;
}
export function crmWorkspace() {
  return workspace;
}

/** `fetch` for CRM client code: tracked by the activity indicator and bound to this tab's workspace. */
export function crmFetch(input: RequestInfo | URL, init?: RequestInit) {
  pending++;
  emit();
  const headers = new Headers(init?.headers);
  if (workspace && !headers.has("x-crm-workspace")) headers.set("x-crm-workspace", workspace);
  return fetch(input, { ...init, headers }).finally(() => {
    pending--;
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRequestsPending() {
  return useSyncExternalStore(
    subscribe,
    () => pending > 0,
    () => false,
  );
}
