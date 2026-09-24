import { session } from "@/lib/crm/server";
import { whatsappReceiverConfigured } from "@/lib/crm/whatsapp-config";

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
    const { data, error } = await query;
    if (error)
      return Response.json(
        { error: "Could not load messages." },
        { status: 503 },
      );
    return Response.json(
      { messages: data.slice(0, 50), has_more: data.length > 50 },
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
      .select("display_phone,active")
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
  return Response.json(
    {
      conversations: conversations.data.slice(0, 50),
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
