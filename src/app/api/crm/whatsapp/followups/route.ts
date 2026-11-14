import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";
import { sendGupshupTemplate } from "@/lib/crm/whatsapp-gupshup";
import { tenantSendConfig } from "@/lib/crm/whatsapp-tenant";

const headers = { "Cache-Control": "private, no-store" };
const SOURCES = [
  "lead_first_name",
  "lead_name",
  "agent_name",
  "business_name",
  "service",
  "follow_up_date",
  "visit_date",
  "visit_time",
  "project_name",
];

export async function GET() {
  const auth = await session();
  if (!auth || auth.member.role === "team")
    return Response.json({ error: "Admin access required." }, { status: 403 });
  const [settings, templates, jobs, connection] = await Promise.all([
    auth.db
      .from("crm_whatsapp_followup_settings")
      .select("enabled,template_id,country_code,visit_reminder_template_id,visit_feedback_template_id")
      .maybeSingle(),
    auth.db.from("crm_whatsapp_templates").select("id,label,provider_template_id,body,params").order("created_at"),
    auth.db
      .from("crm_whatsapp_followup_jobs")
      .select("id,lead_id,status,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    auth.db.from("crm_whatsapp_connections").select("provider,active").maybeSingle(),
  ]);
  if (settings.error || templates.error || jobs.error)
    return Response.json({ error: "Apply the WhatsApp follow-ups migration first." }, { status: 503, headers });
  return Response.json(
    {
      settings: settings.data ?? {
        enabled: false,
        template_id: null,
        country_code: "91",
        visit_reminder_template_id: null,
        visit_feedback_template_id: null,
      },
      templates: templates.data,
      recent: jobs.data,
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
  // Rows are written with the service role, always scoped to the caller's workspace.
  const db = supabase(undefined, true);
  const org = auth.organizationId;
  try {
    const body = await jsonBody(request, 8000);
    if (body.action === "saveTemplate") {
      const label = typeof body.label === "string" ? body.label.trim() : "";
      const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
      const text = typeof body.body === "string" ? body.body.trim() : "";
      const params = Array.isArray(body.params) ? body.params : [];
      if (!label || label.length > 80) throw new Error("Give the template a short name.");
      if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(templateId))
        throw new Error("Paste the template ID from Gupshup → Templates.");
      if (!text || text.length > 1024) throw new Error("Paste the template text exactly as approved.");
      const used = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      const count = used.length ? Math.max(...used) : 0;
      if (count > 10 || params.length !== count || params.some((p) => !SOURCES.includes(p)))
        throw new Error(`Choose what fills each of the template's ${count} variable${count === 1 ? "" : "s"}.`);
      const { error } = await db
        .from("crm_whatsapp_templates")
        .insert({ organization_id: org, label, provider_template_id: templateId, body: text, params });
      if (error)
        throw new Error(
          error.code === "23505" ? "That template is already added." : "The template couldn't be saved.",
        );
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "deleteTemplate") {
      if (typeof body.id !== "string") throw new Error("Choose a template.");
      const { data: settings } = await db
        .from("crm_whatsapp_followup_settings")
        .select("template_id,visit_reminder_template_id,visit_feedback_template_id")
        .eq("organization_id", org)
        .maybeSingle();
      if (settings?.template_id === body.id)
        throw new Error("This template is used for follow-ups. Choose another one first.");
      if (settings?.visit_reminder_template_id === body.id || settings?.visit_feedback_template_id === body.id)
        throw new Error("This template is used for site visit messages. Choose another one first.");
      const { error } = await db
        .from("crm_whatsapp_templates")
        .delete()
        .eq("organization_id", org)
        .eq("id", body.id);
      if (error) throw new Error("Templates that have already been sent can't be removed.");
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "testTemplate") {
      // Sends the template once to a number the admin types, filled with sample lead details.
      // Templates may start a conversation, so no prior "hi" from that number is needed.
      if (typeof body.id !== "string") throw new Error("Choose a template.");
      let to = typeof body.to === "string" ? body.to.replace(/\D/g, "") : "";
      const [{ data: template }, { data: settings }, { data: org_ }] = await Promise.all([
        db
          .from("crm_whatsapp_templates")
          .select("provider_template_id,params")
          .eq("organization_id", org)
          .eq("id", body.id)
          .maybeSingle(),
        db.from("crm_whatsapp_followup_settings").select("country_code").eq("organization_id", org).maybeSingle(),
        db.from("crm_organizations").select("name").eq("id", org).maybeSingle(),
      ]);
      if (!template) throw new Error("Choose one of your templates.");
      if (/^\d{10}$/.test(to)) to = (settings?.country_code ?? "91") + to;
      if (!/^\d{11,15}$/.test(to)) throw new Error("Enter the WhatsApp number to send the test to.");
      const config = await tenantSendConfig(auth.member.id);
      if (!config || config.provider !== "gupshup")
        throw new Error("Connect WhatsApp through Gupshup first.");
      const sample: Record<string, string> = {
        lead_first_name: "Test",
        lead_name: "Test Customer",
        agent_name: auth.member.name,
        business_name: org_?.name ?? "your business",
        service: "your enquiry",
        follow_up_date: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }),
        visit_date: new Date(Date.now() + 86_400_000).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }),
        visit_time: "11:00 AM",
        project_name: "Sunrise Lakeside",
      };
      const result = await sendGupshupTemplate(
        config.token,
        config.app,
        config.phone,
        to,
        template.provider_template_id,
        (template.params as string[]).map((p) => sample[p] ?? ""),
      );
      if (result.status === "accepted")
        return Response.json({ ok: true }, { headers });
      throw new Error(
        result.status === "rejected"
          ? "Gupshup rejected the template. Check that it's approved and the template ID and text match exactly."
          : "Gupshup didn't confirm the message. Check WhatsApp before trying again.",
      );
    }
    if (body.action === "saveSettings") {
      if (auth.member.role !== "owner") throw new Error("Only the owner turns follow-ups on or off.");
      const enabled = body.enabled === true;
      const templateId = typeof body.templateId === "string" && body.templateId ? body.templateId : null;
      const countryCode = typeof body.countryCode === "string" ? body.countryCode.replace(/\D/g, "") : "91";
      if (!/^[1-9][0-9]{0,3}$/.test(countryCode)) throw new Error("Enter a country code like 91.");
      if (enabled && !templateId) throw new Error("Choose the template to send.");
      if (templateId) {
        const { data } = await db
          .from("crm_whatsapp_templates")
          .select("id")
          .eq("organization_id", org)
          .eq("id", templateId)
          .maybeSingle();
        if (!data) throw new Error("Choose one of your templates.");
      }
      const { error } = await db.from("crm_whatsapp_followup_settings").upsert({
        organization_id: org,
        enabled,
        template_id: templateId,
        country_code: countryCode,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error("Settings couldn't be saved.");
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "saveVisitMessages") {
      // Either may be empty (that message is off). Both must be this workspace's templates.
      const pick = (value: unknown) => (typeof value === "string" && value ? value : null);
      const reminderId = pick(body.reminderTemplateId);
      const feedbackId = pick(body.feedbackTemplateId);
      const chosen = [reminderId, feedbackId].filter((id): id is string => id !== null);
      if (chosen.length) {
        const { data } = await db.from("crm_whatsapp_templates").select("id").eq("organization_id", org).in("id", chosen);
        if ((data?.length ?? 0) !== new Set(chosen).size) throw new Error("Choose one of your templates.");
      }
      const { error } = await db.from("crm_whatsapp_followup_settings").upsert({
        organization_id: org,
        visit_reminder_template_id: reminderId,
        visit_feedback_template_id: feedbackId,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error("Couldn't save. Apply the site visits migration first.");
      return Response.json({ ok: true }, { headers });
    }
    throw new Error("Unknown action.");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save." },
      { status: 400, headers },
    );
  }
}
