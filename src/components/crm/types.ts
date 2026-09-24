import type { Lead } from "@/lib/crm/model";

export type View =
  | "Overview"
  | "Leads"
  | "Clients"
  | "Follow-ups"
  | "Reports"
  | "WhatsApp"
  | "Settings";
export type Editing = Lead | "new" | null;
