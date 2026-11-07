import { session, supabase } from "@/lib/crm/server";
import { whatsappReceiverConfigured } from "@/lib/crm/whatsapp-config";

/**
 * Whether automatic replies answer this chat right now: off for the workspace, paused for this
 * chat, quiet until a time (a teammate replied by hand in the last 30 minutes), or on.
 * Read with the service role because team members can't read AI settings; the caller has
 * already been shown the conversation through their own access.
 */
async function aiStatus(organizationId: string, conversation: string) {
  const db = supabase(undefined, true);
  const [settings, chat, manual] = await Promise.all([
    db.from("crm_ai_settings").select("auto_enabled,drafts_enabled").eq("organization_id", organizationId).maybeSingle(),
    db.from("crm_whatsapp_conversations").select("ai_paused,ai_resumed_at").eq("id", conversation).maybeSingle(),
    db
      .from("crm_whatsapp_outbox")
      .select("created_at")
      .eq("conversation_id", conversation)
      .eq("origin", "manual")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  // Before the resume migration ai_resumed_at doesn't exist; report automation as unknown.
  if (settings.error || chat.error || !chat.data) return null;
  const auto = Boolean(settings.data?.auto_enabled && settings.data.drafts_enabled);
  const typed = manual.data?.created_at ? Date.parse(manual.data.created_at) : 0;
  const resumed = chat.data.ai_resumed_at ? Date.parse(chat.data.ai_resumed_at) : 0;
  const quietUntil = typed > resumed && typed + 30 * 60_000 > Date.now() ? new Date(typed + 30 * 60_000).toISOString() : null;
  return { auto, paused: Boolean(chat.data.ai_paused), quiet_until: quietUntil };
}

export async function GET(request: Request) {
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const conversation = params.get("conversation");
  const time = params.get("before_time"),
    id = params.get("before_id");
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    (conversation && !uuid.test(conversation)) ||
    ((time || id) &&
      (!time ||
        !id ||
        !uuid.test(id) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/.test(
          time,
        ) ||
        !Number.isFinite(Date.parse(time))))
  )
    return Response.json({ error: "Invalid inbox request." }, { status: 400 });
  const headers = { "Cache-Control": "private, no-store" };
  if (conversation) {
    const { data: visible, error: accessError } = await auth.db
      .from("crm_whatsapp_conversations")
      .select("id")
      .eq("id", conversation)
      .maybeSingle();
    if (accessError)
      return Response.json({ error: "Inbox unavailable." }, { status: 503 });
    if (!visible)
      return Response.json(
        { error: "Conversation unavailable." },
        { status: 404 },
      );
    let query = auth.db
      .from("crm_whatsapp_messages")
      .select("id,message_type,body,sent_at")
      .eq("conversation_id", conversation)
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (time && id)
      query = query.or(
        `sent_at.lt.${time},and(sent_at.eq.${time},id.lt.${id})`,
      );
    const [{ data, error }, optedOut, ai] = await Promise.all([
      query,
      auth.db.rpc("crm_whatsapp_opted_out", { conversation }),
      aiStatus(auth.organizationId, conversation),
    ]);
    if (error)
      return Response.json(
        { error: "Could not load messages." },
        { status: 503 },
      );
    return Response.json(
      {
        messages: data.slice(0, 50),
        has_more: data.length > 50,
        // Unknown until the opt-in migration is applied; sending still checks it server-side.
        opted_out: optedOut.error ? false : Boolean(optedOut.data),
        ai,
      },
      { headers },
    );
  }
  let query = auth.db
    .from("crm_whatsapp_conversations")
    .select("id,lead_id,sender,contact_name,last_message_at")
    .order("last_message_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(51);
  if (time && id)
    query = query.or(
      `last_message_at.lt.${time},and(last_message_at.eq.${time},id.lt.${id})`,
    );
  const [conversations, connection, latest] = await Promise.all([
    query,
    auth.db
      .from("crm_whatsapp_connections")
      .select("display_phone,active,provider")
      .maybeSingle(),
    auth.member.role !== "team"
      ? auth.db
          .from("crm_whatsapp_messages")
          .select("received_at")
          .order("received_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (conversations.error || connection.error || latest.error)
    return Response.json(
      {
        error:
          "WhatsApp inbox is unavailable. Check that its migration has been applied.",
      },
      { status: 503 },
    );
  const page = conversations.data.slice(0, 50);
  const optedOut = page.length
    ? await auth.db.rpc("crm_whatsapp_opted_out_conversations", {
        ids: page.map((c) => c.id),
      })
    : { data: [], error: null };
  // A set-returning function comes back as plain ids or as { function_name: id } rows.
  const blocked = new Set(
    optedOut.error
      ? []
      : ((optedOut.data ?? []) as unknown[]).map((row) =>
          typeof row === "string" ? row : String(Object.values(row as object)[0]),
        ),
  );
  return Response.json(
    {
      conversations: page.map((c) => ({ ...c, opted_out: blocked.has(c.id) })),
      has_more: conversations.data.length > 50,
      connection: connection.data,
      setup:
        auth.member.role === "team"
          ? null
          : {
              receiver_ready: whatsappReceiverConfigured(process.env),
              last_received_at: latest.data?.received_at ?? null,
            },
    },
    { headers },
  );
}
