"use client";
import { useEffect, useRef, useState } from "react";
import { useWorkspaceContext } from "./context";

type SearchLead = { id: string; name: string; company: string; email: string };
type SearchClient = { id: string; name: string; company: string; email: string };
type Results = { leads: SearchLead[]; clients: SearchClient[] };

export function GlobalSearch() {
  const { demo, setSelected, changeView } = useWorkspaceContext();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (demo || q.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/crm/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          if (active) setResults(data);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, demo]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (demo) return null;
  const showPanel = open && q.trim().length >= 2;
  const empty = results && !results.leads.length && !results.clients.length;

  return (
    <div className="crm-global-search" ref={box}>
      <input
        aria-label="Search everything"
        placeholder="Search everything…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {showPanel && (
        <div className="crm-global-search-results" role="listbox">
          {loading && <p className="crm-muted">Searching…</p>}
          {!loading && empty && <p className="crm-muted">No matches for “{q.trim()}”.</p>}
          {results?.leads.map((l) => (
            <button
              key={`lead-${l.id}`}
              onClick={() => {
                setSelected(l.id);
                setQ("");
                setOpen(false);
              }}
            >
              <strong>{l.name}</strong>
              <small>{l.company || l.email || "Lead"}</small>
            </button>
          ))}
          {results?.clients.map((c) => (
            <button
              key={`client-${c.id}`}
              onClick={() => {
                changeView("Clients");
                setQ("");
                setOpen(false);
              }}
            >
              <strong>{c.name}</strong>
              <small>{c.company || c.email || "Client"} · Client</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
