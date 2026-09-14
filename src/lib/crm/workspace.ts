import type { Client, Lead, Stage, Task, Workspace } from "./model.ts";
import { validateLead } from "./model.ts";

export const dateLabel = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const datetime = (s: string) =>
  new Date(s).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
export const initials = (s: string) =>
  s
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

export function sortedStages(stages: Stage[]) {
  return [...stages].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
}
export function stageOf(stages: Stage[], lead: Lead) {
  return stages.find((s) => s.id === lead.stage_id);
}

export type LeadFilters = { search: string; source: string; owner: string };
export function filterLeads(leads: Lead[], { search, source, owner }: LeadFilters) {
  const q = search.toLowerCase();
  return leads.filter(
    (l) =>
      (!search ||
        [l.name, l.company, l.email, l.phone, l.service].some((s) =>
          s.toLowerCase().includes(q),
        )) &&
      (!source || l.source === source) &&
      (!owner || (owner === "unassigned" ? !l.owner_id : l.owner_id === owner)),
  );
}
export function sourceOptions(leads: Lead[]) {
  return [...new Set(leads.map((l) => l.source).filter(Boolean))];
}

/** Finds an existing lead sharing an email, ignoring `excludeId` (the lead being edited, if any). */
export function findDuplicateLead(leads: Lead[], email: string, excludeId?: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;
  return leads.find((l) => l.id !== excludeId && l.email.toLowerCase() === normalized);
}
export function findDuplicateClient(clients: Client[], email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;
  return clients.find((c) => c.email.toLowerCase() === normalized);
}

export function overdueTasks(tasks: Task[], now: number) {
  return tasks.filter((t) => !t.completed && Date.parse(t.due_at) < now);
}
export function dueFollowUps(leads: Lead[], stages: Stage[], now: number) {
  return leads.filter(
    (l) =>
      l.follow_up &&
      Date.parse(l.follow_up) <= now &&
      stageOf(stages, l)?.kind === "open",
  );
}
export function isOverdueFollowUp(lead: Lead, stages: Stage[], now: number) {
  return Boolean(
    lead.follow_up &&
      Date.parse(lead.follow_up) < now &&
      stageOf(stages, lead)?.kind === "open",
  );
}
export type AttentionItem = { id: string; title: string; lead: string; due: string };
export function attentionItems(
  overdue: Task[],
  dueLeads: Lead[],
  leads: Lead[],
): AttentionItem[] {
  return [
    ...overdue.map((t) => ({
      id: t.id,
      title: t.title,
      lead: t.lead_id,
      due: t.due_at,
    })),
    ...dueLeads.map((l) => ({
      id: l.id,
      title: `Follow up with ${l.name}`,
      lead: l.id,
      due: l.follow_up!,
    })),
  ].filter((item) => leads.some((l) => l.id === item.lead));
}

/**
 * Applies a workspace mutation locally, mirroring the server-side behavior in
 * `POST /api/crm` and the `crm_track_lead`/`crm_log_lead` database triggers.
 * Used only for the in-memory /crm/demo sandbox, which never reaches Supabase.
 */
export function demoMutate(
  data: Workspace,
  body: Record<string, unknown>,
): Workspace {
  const next = structuredClone(data);
  const timestamp = new Date().toISOString();
  const log = (id: string, text: string, kind = "note") =>
    next.activities.push({
      id: crypto.randomUUID(),
      lead_id: id,
      body: text,
      kind,
      created_at: timestamp,
    });
  const lead = next.leads.find((l) => l.id === body.id);
  if (body.action === "saveLead" || body.action === "import") {
    const rows =
      body.action === "import"
        ? (body.rows as Record<string, unknown>[])
        : [body.lead as Record<string, unknown>];
    for (const row of rows) {
      const checked = validateLead(row);
      const existing = body.action === "saveLead" ? lead : undefined;
      const id = existing?.id ?? crypto.randomUUID();
      const stage_id = String(
        row.stage_id ||
          next.stages
            .filter((s) => s.kind === "open")
            .sort((a, b) => a.position - b.position)[0].id,
      );
      if (
        existing?.client_id &&
        next.stages.find((s) => s.id === stage_id)?.kind !== "won"
      )
        throw new Error("Converted leads must remain won.");
      const saved = {
        ...existing,
        ...checked,
        id,
        stage_id,
        owner_id: row.owner_id || null,
        created_at: existing?.created_at ?? timestamp,
        closed_at:
          next.stages.find((s) => s.id === stage_id)?.kind === "open"
            ? null
            : (existing?.closed_at ?? timestamp),
        client_id: existing?.client_id ?? null,
      } as Lead;
      if (existing) next.leads[next.leads.indexOf(existing)] = saved;
      else next.leads.unshift(saved);
      log(
        id,
        existing ? "Lead details updated" : "Lead created",
        existing ? "updated" : "created",
      );
    }
  } else if (body.action === "stage" && lead) {
    const stage = next.stages.find((s) => s.id === body.stage_id)!;
    if (lead.client_id && stage.kind !== "won")
      throw new Error("Converted leads must remain won.");
    lead.stage_id = stage.id;
    lead.closed_at = stage.kind === "open" ? null : timestamp;
    log(lead.id, `Moved to ${stage.name}`, "stage");
  } else if (body.action === "convert" && lead && !lead.client_id) {
    const existing = next.clients.find(
      (c) => c.email && c.email.toLowerCase() === lead.email.toLowerCase(),
    );
    const id = existing?.id ?? crypto.randomUUID();
    if (!existing)
      next.clients.push({
        id,
        name: lead.name,
        company: lead.company,
        email: lead.email,
        phone: lead.phone,
        owner_id: lead.owner_id,
        created_at: timestamp,
      });
    lead.client_id = id;
    lead.stage_id = next.stages.find((s) => s.kind === "won")!.id;
    lead.closed_at = timestamp;
    log(lead.id, "Converted to client", "converted");
  } else if (body.action === "activity" && lead)
    log(lead.id, String(body.body), String(body.kind));
  else if (body.action === "task" && lead)
    next.tasks.push({
      id: crypto.randomUUID(),
      lead_id: lead.id,
      title: String(body.title),
      due_at: String(body.due_at),
      completed: false,
      created_at: timestamp,
    });
  else if (body.action === "completeTask") {
    const task = next.tasks.find((t) => t.id === body.id);
    if (task) task.completed = Boolean(body.completed);
  } else if (body.action === "saveStage") {
    const stage = next.stages.find((s) => s.id === body.id);
    if (next.stages.some((s) => s.name === body.name && s.id !== body.id))
      throw new Error("A stage with this name already exists.");
    if (stage) {
      stage.name = String(body.name);
      stage.position = Number(body.position);
    } else
      next.stages.push({
        id: crypto.randomUUID(),
        name: String(body.name),
        position: Number(body.position),
        kind: "open",
      });
  }
  return next;
}
