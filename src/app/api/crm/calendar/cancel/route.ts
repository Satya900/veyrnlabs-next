import { jsonBody, sameOrigin, session } from "@/lib/crm/server";
import { decryptCalendarToken } from "@/lib/crm/calendar-crypto";
import { deleteCalendarEvent, refreshAccessToken } from "@/lib/crm/google-calendar";

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  try {
    const body = await jsonBody(request, 4000);
    if (
      typeof body.bookingId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(body.bookingId)
    )
      throw new Error("Invalid booking.");
    const { data: prep, error } = await auth.db.rpc(
      "crm_prepare_visit_cancellation",
      { booking: body.bookingId },
    );
    if (error || !prep)
      throw new Error(error?.message || "Could not cancel this visit.");
    const { access_token } = await refreshAccessToken(
      process.env,
      decryptCalendarToken(process.env, prep.refresh_token_encrypted),
    );
    await deleteCalendarEvent(access_token, prep.calendar_id, prep.event_id);
    const { error: finishError } = await auth.db.rpc(
      "crm_finish_visit_cancellation",
      { booking: body.bookingId },
    );
    if (finishError)
      throw new Error(
        "The calendar event was cancelled, but recording it failed. Retry cancelling this same visit.",
      );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not cancel this visit.",
      },
      { status: 400 },
    );
  }
}
