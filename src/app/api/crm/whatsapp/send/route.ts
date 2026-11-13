import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";
import { sendMedia, sendReply } from "@/lib/crm/whatsapp-send";
import { publicFileUrl } from "@/lib/crm/projects";
import { tenantSendConfig } from "@/lib/crm/whatsapp-tenant";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const draft = new URL(request.url).searchParams.get("draft");
  const conversation = new URL(request.url).searchParams.get("conversation");
  if (conversation && /^[0-9a-f-]{36}$/i.test(conversation)) {
    const { data, error } = await auth.db
      .from("crm_whatsapp_outbox")
      .select(
        "id,status,body,created_at,origin,delivery_status,delivery_at,delivery_error_code",
      )
      .eq("conversation_id", conversation)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error)
      return Response.json(
        { error: "Reply history requires the outbound migration." },
        { status: 503, headers },
      );
    return Response.json({ attempts: data }, { headers });
  }
  if (!draft || !/^[0-9a-f-]{36}$/i.test(draft))
    return Response.json({ error: "Invalid draft." }, { status: 400 });
  const { data, error } = await auth.db
    .from("crm_whatsapp_outbox")
    .select(
      "id,status,body,created_at,origin,delivery_status,delivery_at,delivery_error_code",
    )
    .eq("draft_id", draft)
    .maybeSingle();
  if (error)
    return Response.json(
      { error: "Reply sending setup requires its database migration." },
      { status: 503, headers },
    );
  return Response.json(
    {
      attempt: data,
      configured: Boolean(await tenantSendConfig(auth.member.id)),
    },
    { headers },
  );
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const config = await tenantSendConfig(auth.member.id);
  if (!config)
    return Response.json(
      {
        error:
          "Outbound sending is not enabled. Check your messaging allowance and connection setup.",
      },
      { status: 503, headers },
    );
  try {
    const body = await jsonBody(request, 16000);
    const db = supabase(undefined, true);
    let prepared;
    // A project file (brochure, floor plan, photo) sent by link, inside the 24-hour window.
    let media: { url: string; filename: string; caption: string; image: boolean } | null = null;
    if (body.action === "file") {
      if (
        typeof body.conversation !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.conversation) ||
        typeof body.request !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.request) ||
        typeof body.file !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.file)
      )
        throw new Error("Choose a file to send.");
      const { data: file } = await db
        .from("crm_project_files")
        .select("name,mime,storage_path,crm_projects(name)")
        .eq("organization_id", config.org)
        .eq("id", body.file)
        .maybeSingle();
      if (!file) throw new Error("That file is no longer available.");
      const project = file.crm_projects as { name?: string } | { name?: string }[] | null;
      const projectName = (Array.isArray(project) ? project[0]?.name : project?.name) ?? "";
      const extension = file.storage_path.split(".").pop() ?? "pdf";
      const caption = typeof body.caption === "string" ? body.caption.trim().slice(0, 1000) : "";
      media = {
        url: publicFileUrl(process.env.SUPABASE_URL ?? "", file.storage_path),
        filename: `${[projectName, file.name].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]/g, "").slice(0, 150)}.${extension}`,
        caption,
        image: file.mime.startsWith("image/"),
      };
      // Recorded in the chat as a line of text, with the same window, opt-out and access checks
      // as a typed reply, but it doesn't pause the AI: questions about the brochure still get
      // instant answers.
      prepared = await db.rpc("crm_prepare_file_reply", {
        actor: auth.member.id,
        conversation: body.conversation,
        reply_text: `📎 ${projectName ? `${projectName}: ` : ""}${file.name}${caption ? `\n${caption}` : ""}`.slice(0, 3000),
        request: body.request,
        scoped_org: config.org,
        scoped_phone: config.phone,
        scoped_waba: config.waba,
        cost_paise: config.cost,
      });
    } else if (body.action === "manual") {
      // A reply typed by a person; no AI draft involved.
      if (
        typeof body.conversation !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.conversation) ||
        typeof body.request !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.request) ||
        typeof body.text !== "string" ||
        !body.text.trim() ||
        body.text.length > 3000
      )
        throw new Error("Write a reply of 1–3000 characters.");
      prepared = await db.rpc("crm_prepare_manual_reply", {
        actor: auth.member.id,
        conversation: body.conversation,
        reply_text: body.text,
        request: body.request,
        scoped_org: config.org,
        scoped_phone: config.phone,
        scoped_waba: config.waba,
        cost_paise: config.cost,
      });
    } else {
      if (
        typeof body.draft !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.draft) ||
        typeof body.text !== "string" ||
        !body.text.trim() ||
        body.text.length > 3000 ||
        body.approved !== true
      )
        throw new Error("Review and approve a reply of 1–3000 characters.");
      prepared = await db.rpc("crm_prepare_whatsapp_reply", {
        actor: auth.member.id,
        draft: body.draft,
        approved_text: body.text,
        scoped_org: config.org,
        scoped_phone: config.phone,
        scoped_waba: config.waba,
        cost_paise: config.cost,
      });
    }
    const { data: job, error } = prepared;
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "Unable to prepare this reply.",
      );
    if (!job.run) return Response.json({ status: job.status }, { headers });
    const result = media
      ? await sendMedia(config, job.phone, job.recipient, media)
      : await sendReply(config, job.phone, job.recipient, job.body);
    const finished = await db.rpc("crm_finish_whatsapp_reply", {
      job: job.id,
      outcome: result.status,
      message_id: result.messageId,
      cost_paise: config.cost,
    });
    if (finished.error)
      throw new Error(
        "Send outcome needs reconciliation. Do not resend; refresh to inspect the saved attempt.",
      );
    return Response.json({ status: result.status }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Sending failed." },
      { status: 400, headers },
    );
  }
}
