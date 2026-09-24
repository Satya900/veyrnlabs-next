import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";
import { decryptCalendarToken } from "@/lib/crm/calendar-crypto";
import {
  createCalendarEvent,
  findCalendarEvent,
  getFreeBusy,
  refreshAccessToken,
} from "@/lib/crm/google-calendar";
import { overlaps } from "@/lib/crm/calendar-slots";

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  let bookingId: string | undefined;
  let dispatched = false;
  let reservedHere = false;
  const db = supabase(undefined, true);
  async function finish(outcome: string) {
    const { error } = await db.rpc("crm_complete_visit", {
      booking: bookingId,
      outcome,
    });
    if (error)
      throw new Error(
        "Calendar result needs reconciliation. Retry this same slot to check it; do not create another visit.",
      );
  }
  try {
    const body = await jsonBody(request, 4000);
    if (
      typeof body.leadId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(body.leadId)
    )
      throw new Error("Invalid lead.");
    const start = new Date(String(body.startIso)),
      end = new Date(String(body.endIso));
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
      throw new Error("Invalid time.");
    const { data: prep, error } = await auth.db.rpc("crm_prepare_visit", {
      lead: body.leadId,
      start_iso: start.toISOString(),
      end_iso: end.toISOString(),
    });
    if (error || !prep)
      throw new Error(error?.message || "Could not reserve this visit.");
    bookingId = prep.booking_id;
    reservedHere = prep.run;
    if (prep.status === "booked")
      return Response.json({ ok: true, eventId: prep.event_id });
    const { access_token } = await refreshAccessToken(
      process.env,
      decryptCalendarToken(process.env, prep.refresh_token_encrypted),
    );
    if (!prep.run) {
      const existing = await findCalendarEvent(
        access_token,
        prep.calendar_id,
        prep.event_id,
      );
      if (!existing)
        throw new Error(
          "This attempt needs review. No duplicate booking has been sent.",
        );
      await finish("booked");
      return Response.json({ ok: true, ...existing });
    }
    const busy = await getFreeBusy(
      access_token,
      prep.calendar_id,
      start.toISOString(),
      end.toISOString(),
    );
    if (overlaps(start, end, busy)) {
      await finish("rejected");
      return Response.json(
        { error: "This time is no longer available. Choose another slot." },
        { status: 409 },
      );
    }
    dispatched = true;
    const result = await createCalendarEvent(access_token, prep.calendar_id, {
      eventId: prep.event_id,
      summary: `Site visit: ${prep.lead_name}${prep.lead_company ? ` (${prep.lead_company})` : ""}`,
      description: "Booked from Veyrn CRM.",
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      attendeeEmail:
        typeof prep.lead_email === "string" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prep.lead_email)
          ? prep.lead_email
          : undefined,
    });
    await finish("booked");
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (bookingId && reservedHere)
      await db.rpc("crm_complete_visit", {
        booking: bookingId,
        outcome: dispatched ? "unknown" : "rejected",
      });
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not book this visit.",
      },
      { status: 400 },
    );
  }
}
