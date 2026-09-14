import type { Lead } from "@/lib/crm/model";

export type View =
  | "Overview"
  | "Leads"
  | "Clients"
  | "Follow-ups"
  | "Reports"
  | "Settings";
export type Editing = Lead | "new" | null;
