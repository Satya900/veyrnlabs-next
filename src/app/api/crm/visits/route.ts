import { jsonBody, sameOrigin, session } from "@/lib/crm/server";

const headers = { "Cache-Control": "private, no-store" };
const ID = /^[0-9a-f-]{36}$/i;
const STATUSES = ["scheduled", "done", "no_show", "cancelled"];

/** A lead's site visits, newest first, with the WhatsApp messages sent for each. */
export async function GET(request: Request) {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const lead = new URL(request.url).searchParams.get("lead") ?? "";
  if (!ID.test(lead)) return Response.json({ error: "Invalid lead." }, { status: 400 });
  const { data: visits, error } = await auth.db
    .from("crm_site_visits")
    .select("id,starts_at,status,note,feedback,feedback_at,project_id,booking_id")
    .eq("lead_id", lead)
    .order("starts_at", { ascending: false })
    .limit(20);
  if (error) return Response.json({ error: "Apply the site visits migration first." }, { status: 503, headers });
  const ids = visits.map((v) => v.id);
  const { data: messages } = ids.length
    ? await auth.db
        .from("crm_whatsapp_followup_jobs")
        .select("visit_id,visit_kind,status,created_at")
        .in("visit_id", ids)
        .order("created_at")
    : { data: [] };
  return Response.json({ visits, messages: messages ?? [] }, { headers });
}

/** Schedule a visit, or move, close or cancel one. The database checks access and seats. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    const body = await jsonBody(request, 4000);
    const startsAt = typeof body.startsAt === "string" && !Number.isNaN(Date.parse(body.startsAt)) ? new Date(body.startsAt).toISOString() : null;
    let result;
    if (body.action === "schedule") {
      if (typeof body.lead !== "string" || !ID.test(body.lead)) throw new Error("Choose a lead.");
      if (!startsAt) throw new Error("Choose the visit date and time.");
      const project = typeof body.project === "string" && ID.test(body.project) ? body.project : null;
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
      result = await auth.db.rpc("crm_schedule_visit", { lead: body.lead, starts: startsAt, project, visit_note: note });
    } else if (body.action === "update") {
      if (typeof body.visit !== "string" || !ID.test(body.visit)) throw new Error("Choose a visit.");
      if (typeof body.status !== "string" || !STATUSES.includes(body.status)) throw new Error("Invalid status.");
      result = await auth.db.rpc("crm_update_visit", { visit: body.visit, new_status: body.status, new_starts: startsAt });
    } else throw new Error("Unknown action.");
    if (result.error)
      throw new Error(result.error.code === "P0001" ? result.error.message : "Couldn't save the visit. Apply the latest migration.");
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "That didn't work." }, { status: 400, headers });
  }
}
