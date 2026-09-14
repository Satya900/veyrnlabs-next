"use client";
import { createContext, useContext } from "react";
import type { Stage, Workspace as Data } from "@/lib/crm/model";
import type { Editing, View } from "./types";

export type WorkspaceContextValue = {
  data: Data;
  stages: Stage[];
  demo: boolean;
  busy: boolean;
  now: number;
  mutate: (body: Record<string, unknown>) => Promise<boolean>;
  setSelected: (id: string | null) => void;
  setEditing: (value: Editing) => void;
  setNewStage: (id: string | undefined) => void;
  changeView: (view: View) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceContextValue;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx)
    throw new Error("useWorkspaceContext must be used within WorkspaceProvider");
  return ctx;
}
