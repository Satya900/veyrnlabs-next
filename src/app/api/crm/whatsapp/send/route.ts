import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";
import { sendWhatsAppReply } from "@/lib/crm/whatsapp-send";
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
      .limit(20);
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
    { attempt: data, configured: Boolean(await tenantSendConfig(auth.member.id)) },
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
    if (
      typeof body.draft !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(body.draft) ||
      typeof body.text !== "string" ||
      !body.text.trim() ||
      body.text.length > 3000 ||
      body.approved !== true
    )
      throw new Error("Review and approve a reply of 1–3000 characters.");
    const db = supabase(undefined, true);
    const { data: job, error } = await db.rpc("crm_prepare_whatsapp_reply", {
      actor: auth.member.id,
      draft: body.draft,
      approved_text: body.text,
      scoped_org: config.org,
      scoped_phone: config.phone,
      scoped_waba: config.waba,
      cost_paise: config.cost,
    });
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "Unable to prepare this reply.",
      );
    if (!job.run) return Response.json({ status: job.status }, { headers });
    const result = await sendWhatsAppReply(
      config.token,
      job.phone,
      job.recipient,
      job.body,
    );
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
