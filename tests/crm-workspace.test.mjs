import test from "node:test";
import assert from "node:assert/strict";
import { demoWorkspace } from "../src/lib/crm/model.ts";
import {
  applyChanges,
  attentionItems,
  calendarItems,
  demoMutate,
  dueFollowUps,
  filterLeads,
  findDuplicateClient,
  findDuplicateLead,
  groupByDate,
  localDateKey,
  overdueTasks,
  sortedStages,
  sourceOptions,
  stageOf,
} from "../src/lib/crm/workspace.ts";

test("filterLeads matches search across fields and applies source/owner filters", () => {
  const leads = [
    { id: "1", name: "Aarav Shah", company: "Northstar", email: "a@x.com", phone: "", service: "AI", source: "Website", owner_id: "u1" },
    { id: "2", name: "Priya Mehta", company: "Forma", email: "p@x.com", phone: "", service: "CRM", source: "Referral", owner_id: null },
  ];
  assert.deepEqual(filterLeads(leads, { search: "forma", source: "", owner: "" }).map((l) => l.id), ["2"]);
  assert.deepEqual(filterLeads(leads, { search: "", source: "Website", owner: "" }).map((l) => l.id), ["1"]);
  assert.deepEqual(filterLeads(leads, { search: "", source: "", owner: "unassigned" }).map((l) => l.id), ["2"]);
  assert.deepEqual(filterLeads(leads, { search: "", source: "", owner: "u1" }).map((l) => l.id), ["1"]);
  assert.deepEqual(sourceOptions(leads).sort(), ["Referral", "Website"]);
});

test("sortedStages orders by position then name, and stageOf resolves a lead's stage", () => {
  const stages = [
    { id: "b", name: "Zeta", position: 1, kind: "open" },
    { id: "a", name: "Alpha", position: 1, kind: "open" },
    { id: "c", name: "New", position: 0, kind: "open" },
  ];
  assert.deepEqual(sortedStages(stages).map((s) => s.id), ["c", "a", "b"]);
  assert.equal(stageOf(stages, { stage_id: "a" })?.name, "Alpha");
});

test("overdueTasks and dueFollowUps only surface open, past-due items", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");
  const stages = [{ id: "open", name: "New", position: 0, kind: "open" }, { id: "won", name: "Won", position: 1, kind: "won" }];
  const tasks = [
    { id: "t1", completed: false, due_at: "2026-09-14T00:00:00Z" },
    { id: "t2", completed: true, due_at: "2026-09-14T00:00:00Z" },
    { id: "t3", completed: false, due_at: "2026-09-15T00:00:00Z" },
  ];
  assert.deepEqual(overdueTasks(tasks, now).map((t) => t.id), ["t1"]);
  const leads = [
    { id: "l1", stage_id: "open", follow_up: "2026-09-14T00:00:00Z" },
    { id: "l2", stage_id: "won", follow_up: "2026-09-14T00:00:00Z" },
    { id: "l3", stage_id: "open", follow_up: null },
  ];
  assert.deepEqual(dueFollowUps(leads, stages, now).map((l) => l.id), ["l1"]);
});

test("attentionItems combines overdue tasks and due follow-ups, dropping items for unknown leads", () => {
  const leads = [{ id: "l1", name: "Rohan" }];
  const items = attentionItems(
    [{ id: "t1", title: "Send proposal", lead_id: "l1", due_at: "2026-09-14T00:00:00Z" }],
    [{ id: "gone", name: "Ghost", follow_up: "2026-09-14T00:00:00Z" }],
    leads,
  );
  assert.deepEqual(items, [{ id: "t1", title: "Send proposal", lead: "l1", due: "2026-09-14T00:00:00Z" }]);
});

test("findDuplicateLead and findDuplicateClient match case-insensitively and exclude the lead being edited", () => {
  const leads = [
    { id: "l1", email: "Contact@Example.com" },
    { id: "l2", email: "" },
  ];
  const clients = [{ id: "c1", email: "client@example.com" }];
  assert.equal(findDuplicateLead(leads, "contact@example.com")?.id, "l1");
  assert.equal(findDuplicateLead(leads, "contact@example.com", "l1"), undefined);
  assert.equal(findDuplicateLead(leads, ""), undefined);
  assert.equal(findDuplicateLead(leads, "  "), undefined);
  assert.equal(findDuplicateClient(clients, "CLIENT@example.com")?.id, "c1");
  assert.equal(findDuplicateClient(clients, "nobody@example.com"), undefined);
});

test("applyChanges upserts by id, appends new records, and deletes saved views without a reload", () => {
  const data = demoWorkspace();
  const [firstLead, secondLead] = data.leads;

  const patchedName = applyChanges(data, { leads: [{ ...firstLead, name: "Renamed Lead" }] });
  assert.equal(patchedName.leads.find((l) => l.id === firstLead.id).name, "Renamed Lead");
  assert.equal(patchedName.leads.length, data.leads.length);
  assert.equal(patchedName.leads.find((l) => l.id === secondLead.id).name, secondLead.name);

  const newLead = { ...firstLead, id: "brand-new-lead", name: "New Lead" };
  const withNewLead = applyChanges(data, { leads: [newLead] });
  assert.equal(withNewLead.leads.length, data.leads.length + 1);
  assert.ok(withNewLead.leads.some((l) => l.id === "brand-new-lead"));

  const withView = applyChanges(data, {
    saved_views: [{ id: "v1", member_id: "u1", name: "My view", search: "", source: "", owner: "", created_at: "2026-01-01" }],
  });
  assert.equal(withView.saved_views.length, 1);
  const withoutView = applyChanges(withView, { deleted_saved_views: ["v1"] });
  assert.equal(withoutView.saved_views.length, 0);

  const unchanged = applyChanges(data, {});
  assert.deepEqual(unchanged.leads, data.leads);
});

test("demoMutate: create, stage change, and blocking a converted lead from leaving Won", () => {
  const data = demoWorkspace();
  const stages = data.stages;
  const openStage = stages.find((s) => s.kind === "open");
  const wonStage = stages.find((s) => s.kind === "won");

  const created = demoMutate(data, { action: "saveLead", lead: { name: "New Contact", email: "n@x.com" } });
  assert.equal(created.leads[0].name, "New Contact");
  assert.equal(created.leads.length, data.leads.length + 1);
  assert.ok(created.activities.some((a) => a.kind === "created" && a.lead_id === created.leads[0].id));

  const moved = demoMutate(created, {
    action: "stage",
    id: created.leads[0].id,
    stage_id: wonStage.id,
  });
  assert.equal(moved.leads[0].stage_id, wonStage.id);
  assert.ok(moved.leads[0].closed_at);

  const converted = demoMutate(moved, { action: "convert", id: moved.leads[0].id });
  assert.equal(converted.clients.length, 1);
  assert.equal(converted.leads[0].client_id, converted.clients[0].id);

  assert.throws(
    () => demoMutate(converted, { action: "stage", id: converted.leads[0].id, stage_id: openStage.id }),
    /must remain won/,
  );
});

test("localDateKey and groupByDate bucket items by local calendar day", () => {
  assert.equal(localDateKey("2026-09-14T12:00:00Z"), "2026-09-14");
  const items = [
    { id: "a", title: "A", leadId: "l1", due: "2026-09-14T12:00:00Z", kind: "task" },
    { id: "b", title: "B", leadId: "l2", due: "2026-09-14T18:00:00Z", kind: "follow_up" },
    { id: "c", title: "C", leadId: "l3", due: "2026-09-15T12:00:00Z", kind: "task" },
  ];
  const grouped = groupByDate(items);
  assert.equal(grouped["2026-09-14"].length, 2);
  assert.equal(grouped["2026-09-15"].length, 1);
});

test("calendarItems includes incomplete tasks and open-lead follow-ups only", () => {
  const stages = [
    { id: "open", name: "New", position: 0, kind: "open" },
    { id: "won", name: "Won", position: 1, kind: "won" },
  ];
  const data = {
    leads: [
      { id: "l1", name: "Aarav", stage_id: "open", follow_up: "2026-09-20T10:00:00Z" },
      { id: "l2", name: "Priya", stage_id: "won", follow_up: "2026-09-20T10:00:00Z" },
      { id: "l3", name: "Rohan", stage_id: "open", follow_up: null },
    ],
    tasks: [
      { id: "t1", lead_id: "l1", title: "Send proposal", due_at: "2026-09-21T10:00:00Z", completed: false },
      { id: "t2", lead_id: "l1", title: "Old task", due_at: "2026-09-01T10:00:00Z", completed: true },
    ],
    clients: [],
    activities: [],
    stages,
    members: [],
    user: { id: "u1", name: "You", role: "owner" },
  };
  const items = calendarItems(data, stages);
  assert.equal(items.length, 2);
  assert.ok(items.some((i) => i.kind === "task" && i.title === "Send proposal"));
  assert.ok(items.some((i) => i.kind === "follow_up" && i.leadId === "l1"));
});

test("demoMutate: bulkStage moves multiple leads and blocks a converted lead in the same batch", () => {
  const data = demoWorkspace();
  const openStage = data.stages.find((s) => s.kind === "open");
  const otherOpenStage = data.stages.filter((s) => s.kind === "open")[1];
  const wonStage = data.stages.find((s) => s.kind === "won");
  const [a, b] = data.leads;

  const moved = demoMutate(data, {
    action: "bulkStage",
    ids: [a.id, b.id],
    stage_id: otherOpenStage.id,
  });
  assert.equal(moved.leads.find((l) => l.id === a.id).stage_id, otherOpenStage.id);
  assert.equal(moved.leads.find((l) => l.id === b.id).stage_id, otherOpenStage.id);

  const converted = demoMutate(moved, {
    action: "bulkStage",
    ids: [a.id],
    stage_id: wonStage.id,
  });
  const afterConvert = demoMutate(converted, { action: "convert", id: a.id });

  assert.throws(
    () =>
      demoMutate(afterConvert, {
        action: "bulkStage",
        ids: [a.id, b.id],
        stage_id: openStage.id,
      }),
    /must remain won/,
  );
});

test("demoMutate: saveView and deleteView manage saved filters, rejecting duplicate names", () => {
  const data = demoWorkspace();
  const withView = demoMutate(data, {
    action: "saveView",
    name: "My open leads",
    search: "",
    source: "Website",
    owner: "unassigned",
  });
  assert.equal(withView.saved_views.length, 1);
  assert.equal(withView.saved_views[0].source, "Website");
  assert.throws(
    () =>
      demoMutate(withView, {
        action: "saveView",
        name: "my open leads",
        search: "",
        source: "",
        owner: "",
      }),
    /already exists/,
  );
  const removed = demoMutate(withView, {
    action: "deleteView",
    id: withView.saved_views[0].id,
  });
  assert.equal(removed.saved_views.length, 0);
});

test("demoMutate: activity, task, completeTask, and duplicate stage-name rejection", () => {
  const data = demoWorkspace();
  const leadId = data.leads[0].id;
  const withNote = demoMutate(data, { action: "activity", id: leadId, body: "Called back", kind: "call" });
  assert.ok(withNote.activities.some((a) => a.body === "Called back" && a.kind === "call"));

  const withTask = demoMutate(withNote, {
    action: "task",
    id: leadId,
    title: "Send contract",
    due_at: "2026-09-20T10:00:00Z",
  });
  const task = withTask.tasks.find((t) => t.title === "Send contract");
  assert.ok(task && !task.completed);

  const completed = demoMutate(withTask, { action: "completeTask", id: task.id, completed: true });
  assert.equal(completed.tasks.find((t) => t.id === task.id).completed, true);

  assert.throws(
    () => demoMutate(data, { action: "saveStage", name: data.stages[0].name, position: 9 }),
    /already exists/,
  );
});
