import { randomBytes } from "node:crypto";
import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";

const headers = { "Cache-Control": "private, no-store" };
const newToken = () => randomBytes(18).toString("base64url");

/** Lead capture settings for owners and admins. */
export async function GET() {
  const auth = await session();
  if (!auth || auth.member.role === "team")
    return Response.json({ error: "Admin access required." }, { status: 403 });
  const since = new Date(Date.now() - 7 * 86400e3).toISOString();
  const [capture, templates, members, recent, week, connection] = await Promise.all([
    auth.db.from("crm_lead_capture").select("token,enabled,welcome_template_id,assign_to").maybeSingle(),
    auth.db.from("crm_whatsapp_templates").select("id,label,body").order("created_at"),
    auth.db.from("crm_members").select("id,name,role").order("name"),
    auth.db
      .from("crm_lead_capture_events")
      .select("id,lead_id,status,source,created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    auth.db.from("crm_lead_capture_events").select("status").gte("created_at", since).neq("status", "ignored"),
    auth.db.from("crm_whatsapp_connections").select("provider,active").maybeSingle(),
  ]);
  if (capture.error || recent.error || week.error)
    return Response.json({ error: "Apply the lead capture migration first." }, { status: 503, headers });
  const ids = [...new Set(recent.data.map((e) => e.lead_id).filter(Boolean))];
  const names = ids.length
    ? ((await auth.db.from("crm_leads").select("id,name").in("id", ids)).data ?? [])
    : [];
  return Response.json(
    {
      capture: capture.data,
      templates: templates.data ?? [],
      members: members.data ?? [],
      recent: recent.data.map((e) => ({ ...e, name: names.find((n) => n.id === e.lead_id)?.name ?? null })),
      week: {
        created: week.data.filter((e) => e.status === "created").length,
        existing: week.data.filter((e) => e.status === "existing").length,
      },
      gupshupConnected: connection.data?.provider === "gupshup" && connection.data.active,
    },
    { headers },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth || auth.member.role === "team")
    return Response.json({ error: "Admin access required." }, { status: 403 });
  // Written with the service role, always scoped to the caller's workspace.
  const db = supabase(undefined, true);
  const org = auth.organizationId;
  try {
    const body = await jsonBody(request, 4000);
    const { data: current } = await db
      .from("crm_lead_capture")
      .select("token")
      .eq("organization_id", org)
      .maybeSingle();
    let change: Record<string, unknown>;
    if (body.action === "enable") change = { enabled: true, token: current?.token ?? newToken() };
    else if (body.action === "disable") change = { enabled: false };
    else if (body.action === "rotate") change = { token: newToken() };
    else if (body.action === "save") {
      const template = typeof body.welcomeTemplateId === "string" && body.welcomeTemplateId ? body.welcomeTemplateId : null;
      const assignee = typeof body.assignTo === "string" && body.assignTo ? body.assignTo : null;
      if (template) {
        const { data } = await db.from("crm_whatsapp_templates").select("id").eq("organization_id", org).eq("id", template).maybeSingle();
        if (!data) throw new Error("Choose one of your WhatsApp templates.");
      }
      if (assignee) {
        const { data } = await db.from("crm_members").select("id").eq("organization_id", org).eq("id", assignee).maybeSingle();
        if (!data) throw new Error("Choose someone from your team.");
      }
      change = { welcome_template_id: template, assign_to: assignee };
    } else throw new Error("Unknown action.");
    if (!current && body.action !== "enable") throw new Error("Turn on lead capture first.");
    const { error } = current
      ? await db.from("crm_lead_capture").update({ ...change, updated_at: new Date().toISOString() }).eq("organization_id", org)
      : await db.from("crm_lead_capture").insert({ organization_id: org, ...change });
    if (error) throw new Error("Couldn't save. Try again.");
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Couldn't save." },
      { status: 400, headers },
    );
  }
}
