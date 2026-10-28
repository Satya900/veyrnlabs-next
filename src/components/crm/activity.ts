"use client";
import { useSyncExternalStore } from "react";

// Counts CRM requests in flight so one shared indicator (ActivityBar) can show that the
// server is working, without every component wiring its own busy flag into a global.
let pending = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** `fetch` for CRM client code: identical behaviour, but tracked by the activity indicator. */
export function crmFetch(input: RequestInfo | URL, init?: RequestInit) {
  pending++;
  emit();
  return fetch(input, init).finally(() => {
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
