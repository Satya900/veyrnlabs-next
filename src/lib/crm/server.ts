import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Member, Workspace } from "./model";
export { sameOrigin } from "./origin";

export const configured = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
export const cookieName = "veyrn_crm_session";
export function supabase(token?: string, service = false) {
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
      ? { global: { headers: { Authorization: `Bearer ${token}` } } }
      : {}),
  });
}
export async function session() {
  if (!configured()) return null;
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const db = supabase(token);
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user) return null;
  const { data: member } = await db
    .from("crm_members")
    .select("id,name,role")
    .eq("id", user.id)
    .single();
  if (!member) return null;
  return { db, member: member as Member };
}

type Auth = { db: ReturnType<typeof supabase>; member: Member };
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
  const [results, planResult] = await Promise.all([
    Promise.all(WORKSPACE_TABLES.map((name) => fetchAllRows(auth.db, `crm_${name}`))),
    auth.db.rpc("crm_plan_tier"),
  ]);
  const data: Record<string, unknown> = {
    user: auth.member,
    plan: planResult.data ?? { plan: null, active: false },
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
