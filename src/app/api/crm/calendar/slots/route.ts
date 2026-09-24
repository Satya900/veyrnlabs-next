import { session } from "@/lib/crm/server";
import { decryptCalendarToken } from "@/lib/crm/calendar-crypto";
import { getFreeBusy, refreshAccessToken } from "@/lib/crm/google-calendar";

/** Returns busy blocks only; the caller's own UI decides the candidate slot grid
 * (increment, displayed hours) and subtracts these to find what's free. */
export async function GET(request: Request) {
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const url = new URL(request.url);
  const leadId = url.searchParams.get("leadId") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if (!/^[a-f0-9-]{36}$/i.test(leadId))
    return Response.json({ error: "Invalid lead." }, { status: 400 });
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (
    !from ||
    !to ||
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    toDate <= fromDate ||
    toDate.getTime() - fromDate.getTime() > 7 * 86_400_000
  )
    return Response.json({ error: "Invalid date range." }, { status: 400 });
  const { data: connection, error: connError } = await auth.db.rpc(
    "crm_calendar_connection_for_lead",
    { lead: leadId },
  );
  if (connError || !connection)
    return Response.json(
      { error: connError?.message || "No connected calendar for this lead's agent." },
      { status: 400 },
    );
  try {
    const refreshToken = decryptCalendarToken(
      process.env,
      connection.refresh_token_encrypted,
    );
    const { access_token } = await refreshAccessToken(process.env, refreshToken);
    const busy = await getFreeBusy(
      access_token,
      connection.calendar_id,
      fromDate.toISOString(),
      toDate.toISOString(),
    );
    return Response.json(
      { busy },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not read availability." },
      { status: 502 },
    );
  }
}
