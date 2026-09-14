"use client";
import { useEffect, useRef } from "react";
import { ImportReview } from "./ImportReview";
import { LeadDetail } from "./LeadDetail";
import { LeadForm } from "./LeadForm";
import type { Editing } from "./types";
import type { Lead, Workspace as Data } from "@/lib/crm/model";

export function LeadDialog({
  data,
  busy,
  error,
  mutate,
  editing,
  setEditing,
  selected,
  setSelected,
  newStage,
  setNewStage,
  importRows,
  setImportRows,
}: {
  data: Data;
  busy: boolean;
  error: string;
  mutate: (body: Record<string, unknown>) => Promise<boolean>;
  editing: Editing;
  setEditing: (value: Editing) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  newStage: string | undefined;
  setNewStage: (id: string | undefined) => void;
  importRows: Record<string, unknown>[] | null;
  setImportRows: (rows: Record<string, unknown>[] | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const current = data.leads.find((l) => l.id === selected);
  useEffect(() => {
    if (editing || selected || importRows) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing, selected, importRows]);
  const close = () => {
    if (!busy) {
      setEditing(null);
      setSelected(null);
      setImportRows(null);
      setNewStage(undefined);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="crm-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="crm-dialog-inner">
        <button className="dialog-close" aria-label="Close dialog" disabled={busy} onClick={close}>
          ×
        </button>
        {error && (
          <p role="alert" className="crm-error">
            {error}
          </p>
        )}
        {editing ? (
          <LeadForm
            key={editing === "new" ? "new" : editing.id}
            lead={editing === "new" ? undefined : (editing as Lead)}
            defaultStage={newStage}
            data={data}
            busy={busy}
            onOpenExisting={(leadId) => {
              setEditing(null);
              setNewStage(undefined);
              setSelected(leadId);
            }}
            save={async (values) => {
              if (
                await mutate({
                  action: "saveLead",
                  id: editing === "new" ? undefined : (editing as Lead).id,
                  lead: values,
                })
              ) {
                setEditing(null);
                setNewStage(undefined);
              }
            }}
          />
        ) : importRows ? (
          <ImportReview
            rows={importRows}
            busy={busy}
            onImport={async () => {
              if (await mutate({ action: "import", rows: importRows })) setImportRows(null);
            }}
          />
        ) : current ? (
          <LeadDetail
            current={current}
            data={data}
            busy={busy}
            mutate={mutate}
            onEdit={() => setEditing(current)}
          />
        ) : null}
      </div>
    </dialog>
  );
}
