import { supabase } from "@/lib/crm/server";
import { parseGupshupCallback } from "@/lib/crm/whatsapp-gupshup";

export const runtime = "nodejs";

// Gupshup doesn't sign callbacks, so the unguessable per-connection token in this URL is
// what ties a delivery to one workspace. It's checked before anything is parsed or stored.
async function connection(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const { data } = await supabase(undefined, true)
    .from("crm_whatsapp_connections")
    .select("phone_number_id,active,provider")
    .eq("callback_token", token)
    .maybeSingle();
  return data?.active && data.provider === "gupshup" ? data : null;
}

// Gupshup checks a callback URL is reachable when it's set.
export async function GET(_request: Request, ctx: RouteContext<"/api/webhooks/gupshup/[token]">) {
  const { token } = await ctx.params;
  return (await connection(token))
    ? new Response("ok", { headers: { "Cache-Control": "no-store" } })
    : new Response("Not found", { status: 404 });
}

export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/gupshup/[token]">) {
  const { token } = await ctx.params;
  const target = await connection(token);
  if (!target) return new Response("Not found", { status: 404 });
  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1_048_576) return new Response("Too large", { status: 413 });
    // Gupshup's set-callback check may post an empty body.
    if (!raw.trim()) return Response.json({ received: true });
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  // Logs only the callback's shape, never its content, so deliveries are traceable.
  const shape = {
    format: (payload as { object?: unknown })?.object === "whatsapp_business_account" ? "meta" : "gupshup",
    type: String((payload as { type?: unknown })?.type ?? ""),
  };
  let parsed;
  try {
    parsed = parseGupshupCallback(payload, target.phone_number_id);
  } catch {
    console.warn("gupshup webhook: unreadable event", shape);
    return new Response("Invalid event", { status: 400 });
  }
  console.info("gupshup webhook", { ...shape, messages: parsed.events.length, receipts: parsed.receipts.length });
  const db = supabase(undefined, true);
  if (parsed.receipts.length) {
    const { error } = await db.rpc("crm_receive_whatsapp_receipts", { events: parsed.receipts });
    if (error) return new Response("Please retry receipts", { status: 503 });
  }
  if (parsed.events.length) {
    // Same storage as Meta deliveries: one transaction, duplicates ignored in SQL.
    const { error } = await db.rpc("crm_receive_whatsapp", { events: parsed.events });
    if (error) return new Response("Please retry delivery", { status: 503 });
  }
  return Response.json({ received: true });
}
