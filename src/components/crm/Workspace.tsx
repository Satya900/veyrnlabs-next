"use client";
import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { dueFollowUps, overdueTasks, sortedStages } from "@/lib/crm/workspace";
import type { Workspace as Data } from "@/lib/crm/model";
import type { Editing, View } from "./types";
import { useWorkspaceData } from "./useWorkspaceData";
import { WorkspaceProvider } from "./context";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ReportingSummary } from "./ReportingSummary";
import { LeadDialog } from "./LeadDialog";
import { Overview } from "./views/Overview";
import { Leads } from "./views/Leads";
import { Clients } from "./views/Clients";
import { FollowUps } from "./views/FollowUps";
import { Reports } from "./views/Reports";
import { Settings } from "./views/Settings";

const pageCopy: Record<View, { eyebrow: string; heading: string; body: string }> = {
  Overview: {
    eyebrow: "THE BIG PICTURE",
    heading: "A clearer view of what’s next.",
    body: "Your opportunities, relationships, and next steps. All in one place.",
  },
  Leads: {
    eyebrow: "YOUR BUSINESS, ORGANIZED",
    heading: "Leads",
    body: "Turn your next conversation into your next client.",
  },
  Clients: {
    eyebrow: "YOUR BUSINESS, ORGANIZED",
    heading: "Clients",
    body: "The relationships you’re building something great with.",
  },
  "Follow-ups": {
    eyebrow: "YOUR BUSINESS, ORGANIZED",
    heading: "Keep the conversation going.",
    body: "A little follow-through goes a long way.",
  },
  Reports: {
    eyebrow: "YOUR BUSINESS, ORGANIZED",
    heading: "Reports",
    body: "Understand what’s moving your business forward.",
  },
  Settings: {
    eyebrow: "YOUR BUSINESS, ORGANIZED",
    heading: "Settings",
    body: "Make this workspace work for you.",
  },
};

export default function Workspace({
  demo,
  initialData = null,
}: {
  demo: boolean;
  initialData?: Data | null;
}) {
  const {
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
  } = useWorkspaceData(demo, initialData);
  const [view, setView] = useState<View>("Overview");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");
  const [board, setBoard] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [newStage, setNewStage] = useState<string | undefined>();
  const [importRows, setImportRows] = useState<Record<string, unknown>[] | null>(null);
  const [from, setFrom] = useState(() => {
    const today = new Date();
    return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const changeView = (v: View) => {
    setView(v);
    setSearch("");
    setSource("");
    setOwner("");
  };

  if (!data && !error) return <WorkspaceSkeleton />;
  if (!data)
    return (
      <main className="crm-loading">
        <Logo href="/" eager />
        <h1>Workspace unavailable</h1>
        <p role="alert">{error}</p>
        <Link href="/crm/login">Go to sign in</Link>
        <button
          onClick={() => {
            setError("");
            reload().catch((e) => setError(e.message));
          }}
        >
          Try again
        </button>
      </main>
    );

  const stages = sortedStages(data.stages);
  const overdueCount =
    overdueTasks(data.tasks, now).length + dueFollowUps(data.leads, stages, now).length;
  const copy = pageCopy[view];

  return (
    <WorkspaceProvider
      value={{
        data,
        stages,
        demo,
        busy,
        now,
        mutate,
        optimisticMutate,
        setSelected,
        setEditing,
        setNewStage,
        changeView,
      }}
    >
      <div className="crm-shell">
        <Sidebar
          view={view}
          changeView={changeView}
          overdueCount={overdueCount}
          user={data.user}
          demo={demo}
          onAddLead={() => setEditing("new")}
          onSignOutError={setError}
        />
        <div className="crm-main">
          <Topbar view={view} demo={demo} user={data.user} />
          <main className="crm-content">
            <div className="crm-page-heading">
              <div>
                <Eyebrow>{copy.eyebrow}</Eyebrow>
                <h1>{copy.heading}</h1>
                <p>{copy.body}</p>
              </div>
              {view !== "Settings" && (
                <button className="crm-primary" onClick={() => setEditing("new")}>
                  <span>＋</span> Add lead
                </button>
              )}
            </div>
            {error && (
              <div role="alert" className="crm-error">
                {error}{" "}
                <Link href="/crm/login" target="_blank">
                  Sign in
                </Link>
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  ×
                </button>
              </div>
            )}
            {message && (
              <div role="status" className="crm-success">
                {message}
                <button aria-label="Dismiss notification" onClick={() => setMessage("")}>
                  ×
                </button>
              </div>
            )}
            {(view === "Overview" || view === "Reports") && (
              <ReportingSummary from={from} to={to} setFrom={setFrom} setTo={setTo} />
            )}
            {view === "Overview" && <Overview />}
            {view === "Leads" && (
              <Leads
                search={search}
                setSearch={setSearch}
                source={source}
                setSource={setSource}
                owner={owner}
                setOwner={setOwner}
                board={board}
                setBoard={setBoard}
                setImportRows={setImportRows}
                setError={setError}
              />
            )}
            {view === "Clients" && <Clients />}
            {view === "Follow-ups" && <FollowUps />}
            {view === "Reports" && <Reports from={from} to={to} />}
            {view === "Settings" && <Settings />}
            <footer className="crm-content-footer">
              <span>Veyrn Labs Workspace</span>
              <span>A little structure. A lot of possibility.</span>
            </footer>
          </main>
        </div>
        <LeadDialog
          data={data}
          busy={busy}
          error={error}
          mutate={mutate}
          optimisticMutate={optimisticMutate}
          editing={editing}
          setEditing={setEditing}
          selected={selected}
          setSelected={setSelected}
          newStage={newStage}
          setNewStage={setNewStage}
          importRows={importRows}
          setImportRows={setImportRows}
        />
      </div>
    </WorkspaceProvider>
  );
}
