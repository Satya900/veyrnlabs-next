import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import type { Member, Workspace } from "./model";
export { sameOrigin } from "./origin";

export const configured = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
export const cookieName = "veyrn_crm_session";
/** The business the signed-in login is working in, when it belongs to more than one. */
export const organizationCookieName = "veyrn_crm_org";
/** Sent by each browser tab so its requests act in the workspace that tab is showing. */
export const workspaceHeaderName = "x-crm-workspace";
export type Membership = {
  member_id: string;
  organization_id: string;
  organization_name: string;
  role: Member["role"];
  active: boolean;
};
export function supabase(token?: string, service = false, organization?: string) {
  const url = process.env.SUPABASE_URL;
  const key = service
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("CRM setup is incomplete.");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(token
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
              // Read by crm_member_id(); the database ignores it unless the login is a
              // member of that business.
              ...(organization ? { "x-crm-organization": organization } : {}),
            },
          },
        }
      : {}),
  });
}
/**
 * The signed-in member, scoped to one workspace. An explicit `organization` (or the tab's
 * x-crm-workspace header) wins over the last-chosen cookie, so a tab left open on one
 * business keeps acting there after another tab switches; a requested workspace the login
 * doesn't belong to yields no session rather than a silent fallback.
 */
export async function session(organization?: string) {
  if (!configured()) return null;
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const db = supabase(token);
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await db.rpc("crm_my_memberships");
  const memberships = ((data ?? []) as Membership[]).filter((m) => m.active);
  if (!memberships.length) return null;
  const requested =
    organization ?? (await headers()).get(workspaceHeaderName) ?? undefined;
  let current: Membership | undefined;
  if (requested) {
    current = memberships.find((m) => m.organization_id === requested);
    if (!current) return null;
  } else {
    const chosen = (await cookies()).get(organizationCookieName)?.value;
    current =
      memberships.find((m) => m.organization_id === chosen) ?? memberships[0];
  }
  const scoped = supabase(token, false, current.organization_id);
  const { data: member } = await scoped
    .from("crm_members")
    .select("id,name,role")
    .eq("id", current.member_id)
    .single();
  if (!member) return null;
  return {
    db: scoped,
    member: member as Member,
    organizationId: current.organization_id,
    memberships,
  };
}

type Auth = {
  db: ReturnType<typeof supabase>;
  member: Member;
  organizationId: string;
  memberships: Membership[];
};
const WORKSPACE_TABLES = [
  "leads",
  "clients",
  "tasks",
  "activities",
  "stages",
  "members",
  "saved_views",
] as const;
async function fetchAllRows(db: Auth["db"], table: string) {
  // Page through PostgREST's default row limit so reports/exports do not silently truncate.
  const rows: unknown[] = [];
  let offset = 0;
  while (true) {
    const result = await db
      .from(table)
      .select("*")
      .order("id")
      .range(offset, offset + 499);
    if (result.error) throw new Error("workspace-load-failed");
    rows.push(...result.data);
    if (result.data.length < 500) break;
    offset += 500;
  }
  return rows;
}
/** Loads every workspace table the current member can see, in parallel rather than one at a time. */
export async function loadWorkspace(auth: Auth): Promise<Workspace> {
  const [results, planResult, orgResult] = await Promise.all([
    Promise.all(WORKSPACE_TABLES.map((name) => fetchAllRows(auth.db, `crm_${name}`))),
    auth.db.rpc("crm_plan_tier"),
    // RLS limits this to the member's own organization.
    auth.db.from("crm_organizations").select("name").maybeSingle(),
  ]);
  const data: Record<string, unknown> = {
    user: auth.member,
    plan: planResult.data ?? { plan: null, active: false },
    organization: orgResult.data ?? undefined,
    organizationId: auth.organizationId,
    memberships: auth.memberships.map((m) => ({
      organization_id: m.organization_id,
      organization_name: m.organization_name,
      role: m.role,
    })),
  };
  WORKSPACE_TABLES.forEach((name, i) => {
    data[name] = results[i];
  });
  return data as unknown as Workspace;
}

export async function jsonBody(
  request: Request,
  max = 100_000,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("Expected JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error("Request is too large.");
    }
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid request.");
  return body;
}
