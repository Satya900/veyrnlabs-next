export type Role = "owner" | "admin" | "team";
export type Stage = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
};
export type Member = { id: string; name: string; role: Role };
export type Lead = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  service: string;
  value: number;
  source: string;
  stage_id: string;
  owner_id: string | null;
  notes: string;
  follow_up: string | null;
  created_at: string;
  closed_at: string | null;
  client_id: string | null;
};
export type Client = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  owner_id: string | null;
  created_at: string;
};
export type Task = {
  id: string;
  lead_id: string;
  title: string;
  due_at: string;
  completed: boolean;
  created_at: string;
};
export type Activity = {
  id: string;
  lead_id: string;
  body: string;
  kind: string;
  created_at: string;
};
export type SavedView = {
  id: string;
  member_id: string;
  name: string;
  search: string;
  source: string;
  owner: string;
  created_at: string;
};
export type Workspace = {
  leads: Lead[];
  clients: Client[];
  tasks: Task[];
  activities: Activity[];
  stages: Stage[];
  members: Member[];
  saved_views: SavedView[];
  user: Member;
};
export const defaultStages: Stage[] = [
  "New",
  "Contacted",
  "Discovery scheduled",
  "Qualified",
  "Proposal sent",
  "Negotiation",
  "Won",
  "Lost",
].map((name, position) => ({
  id: `stage-${position}`,
  name,
  position,
  kind: position === 6 ? "won" : position === 7 ? "lost" : "open",
}));
export const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export function validateLead(input: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of [
    "name",
    "company",
    "email",
    "phone",
    "service",
    "source",
    "notes",
  ]) {
    const value = input[key] ?? "";
    if (
      typeof value !== "string" ||
      value.length > (key === "notes" ? 5000 : 200)
    )
      throw new Error(`Invalid ${key}.`);
    result[key] = value.trim();
  }
  if (!result.name) throw new Error("A contact name is required.");
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(result.email)))
    throw new Error("Enter a valid email address.");
  const value = Number(input.value ?? 0);
  if (!Number.isFinite(value) || value < 0 || value > 1e12)
    throw new Error("Deal value must be between 0 and 1 trillion.");
  result.value = value;
  for (const key of ["stage_id", "owner_id"]) {
    if (
      input[key] !== undefined &&
      input[key] !== null &&
      typeof input[key] !== "string"
    )
      throw new Error(`Invalid ${key}.`);
    if (input[key] !== undefined) result[key] = input[key] || null;
  }
  if (
    input.follow_up &&
    (typeof input.follow_up !== "string" ||
      !Number.isFinite(Date.parse(input.follow_up)))
  )
    throw new Error("Invalid follow-up date.");
  result.follow_up = input.follow_up
    ? new Date(String(input.follow_up)).toISOString()
    : null;
  return result;
}

export function metrics(data: Workspace, from: string, to: string) {
  const inRange = (date: string | null) =>
    !!date && date >= `${from}T00:00:00` && date <= `${to}T23:59:59.999Z`;
  const kind = (lead: Lead) =>
    data.stages.find((s) => s.id === lead.stage_id)?.kind;
  const closed = data.leads.filter(
    (l) => kind(l) !== "open" && inRange(l.closed_at),
  );
  const won = closed.filter((l) => kind(l) === "won");
  return {
    newLeads: data.leads.filter((l) => inRange(l.created_at)).length,
    pipeline: data.leads
      .filter((l) => kind(l) === "open")
      .reduce((n, l) => n + l.value, 0),
    won: won.length,
    wonValue: won.reduce((n, l) => n + l.value, 0),
    rate: closed.length ? Math.round((won.length / closed.length) * 100) : null,
  };
}

export const csvHeaders = [
  "name",
  "company",
  "email",
  "phone",
  "service",
  "value",
  "source",
  "notes",
];
export function exportCsv(
  rows: Record<string, unknown>[],
  headers = csvHeaders,
) {
  const cell = (value: unknown) => {
    const s = String(value ?? "");
    return `"${(/^[\s]*[=+@-]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`;
  };
  return [
    headers.map(cell).join(","),
    ...rows.map((row) => headers.map((h) => cell(row[h])).join(",")),
  ].join("\r\n");
}
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw new Error("CSV contains an unclosed quote.");
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  if (!headers.includes("name") || new Set(headers).size !== headers.length)
    throw new Error("CSV needs a unique name column and no duplicate headers.");
  if (rows.length > 500) throw new Error("Import up to 500 leads at a time.");
  return rows.map((r, i) => {
    if (r.length !== headers.length)
      throw new Error(`Row ${i + 2} has the wrong number of columns.`);
    return validateLead(Object.fromEntries(headers.map((h, j) => [h, r[j]])));
  });
}

export function demoWorkspace(): Workspace {
  const now = new Date();
  const ago = (days: number) =>
    new Date(now.getTime() - days * 86400000).toISOString();
  const user: Member = { id: "demo-owner", name: "You", role: "owner" };
  const names = [
    [
      "Aarav Shah",
      "Northstar Studio",
      "Website",
      "AI workflow automation",
      180000,
      0,
    ],
    [
      "Priya Mehta",
      "Forma Health",
      "Referral",
      "Client management platform",
      320000,
      3,
    ],
    ["Rohan Das", "Orbit Commerce", "LinkedIn", "Custom dashboard", 95000, 4],
    [
      "Ananya Rao",
      "Bloom Collective",
      "Website",
      "Website development",
      75000,
      1,
    ],
    [
      "Kabir Sen",
      "Arc Logistics",
      "Outbound",
      "Operations automation",
      240000,
      5,
    ],
    ["Meera Iyer", "Fieldwork", "Referral", "AI assistant", 150000, 2],
  ];
  const leads: Lead[] = names.map(
    ([name, company, source, service, value, stage], i) => ({
      id: `demo-${i}`,
      name: String(name),
      company: String(company),
      source: String(source),
      service: String(service),
      value: Number(value),
      stage_id: `stage-${stage}`,
      email: `contact${i + 1}@example.com`,
      phone: "",
      owner_id: user.id,
      notes: "Sample lead for exploring your workspace.",
      follow_up: ago(i === 0 ? 1 : -i),
      created_at: ago(i + 1),
      closed_at: null,
      client_id: null,
    }),
  );
  return {
    leads,
    stages: defaultStages,
    clients: [],
    members: [user],
    saved_views: [],
    user,
    tasks: [
      {
        id: "demo-task",
        lead_id: "demo-2",
        title: "Follow up on the dashboard proposal",
        due_at: ago(1),
        completed: false,
        created_at: ago(2),
      },
    ],
    activities: leads.map((l) => ({
      id: `activity-${l.id}`,
      lead_id: l.id,
      body: "Lead added to the workspace",
      kind: "created",
      created_at: l.created_at,
    })),
  };
}
