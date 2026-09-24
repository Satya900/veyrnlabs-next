import { workerAuthorized } from "@/lib/crm/worker-auth";
import { jsonBody, supabase } from "@/lib/crm/server";
import { decryptCalendarToken } from "@/lib/crm/calendar-crypto";
import {
  findCalendarEvent,
  refreshAccessToken,
} from "@/lib/crm/google-calendar";
export async function POST(request: Request) {
  if (!workerAuthorized(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = supabase(undefined, true);
  try {
    const body = await jsonBody(request, 4000);
    if (body.kind === "usage") {
      if (
        typeof body.cost !== "number" ||
        !Number.isSafeInteger(body.cost) ||
        body.cost < 0 ||
        typeof body.cancelled !== "boolean" ||
        typeof body.evidence !== "string"
      )
        throw new Error("Trusted provider cost and evidence are required.");
      const { error } = await db.rpc("crm_reconcile_usage", {
        org: body.organizationId,
        event: body.eventId,
        cost: body.cost,
        cancelled: body.cancelled,
        evidence: body.evidence,
      });
      if (error)
        throw new Error(
          "Usage reconciliation rejected; verify the event and provider evidence.",
        );
      return Response.json({ ok: true });
    }
    if (body.kind !== "booking" || typeof body.bookingId !== "string")
      throw new Error("Unknown reconciliation action.");
    const { data: booking } = await db
      .from("crm_calendar_bookings")
      .select("id,organization_id,member_id,event_id,status")
      .eq("id", body.bookingId)
      .single();
    if (!booking) throw new Error("Booking unavailable.");
    const { data: connection } = await db
      .from("crm_calendar_connections")
      .select("calendar_id,refresh_token_encrypted")
      .eq("organization_id", booking.organization_id)
      .eq("member_id", booking.member_id)
      .single();
    if (!connection)
      throw new Error("Reconnect the agent’s calendar before reconciliation.");
    const { access_token } = await refreshAccessToken(
      process.env,
      decryptCalendarToken(process.env, connection.refresh_token_encrypted),
    );
    const event = await findCalendarEvent(
      access_token,
      connection.calendar_id,
      booking.event_id,
    );
    if (!event)
      return Response.json({
        found: false,
        message:
          "No event found. The reservation remains held for manual review; no booking was retried.",
      });
    const { error } = await db.rpc("crm_complete_visit", {
      booking: booking.id,
      outcome: "booked",
    });
    if (error)
      throw new Error(
        "Event found but CRM update failed. Retry reconciliation.",
      );
    return Response.json({ ok: true, eventId: event.eventId });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Reconciliation failed.",
      },
      { status: 400 },
    );
  }
}
