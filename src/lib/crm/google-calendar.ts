type Env = Record<string, string | undefined>;

export function googleCalendarConfigured(env: Env) {
  return Boolean(
    env.GOOGLE_CALENDAR_CLIENT_ID &&
    env.GOOGLE_CALENDAR_CLIENT_SECRET &&
    env.CRM_CALENDAR_TOKEN_KEY,
  );
}

const SCOPE =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy";

export function googleAuthorizeUrl(
  env: Env,
  redirectUri: string,
  state: string,
) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CALENDAR_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Always show consent so a refresh token is issued even on a reconnect.
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

async function tokenRequest(
  env: Env,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      ...body,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.access_token !== "string")
    throw new Error(data?.error_description || "Google token request failed.");
  return data as TokenResponse;
}

export function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
) {
  return tokenRequest(
    env,
    { code, redirect_uri: redirectUri, grant_type: "authorization_code" },
    fetchImpl,
  );
}

export function refreshAccessToken(
  env: Env,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  return tokenRequest(
    env,
    { refresh_token: refreshToken, grant_type: "refresh_token" },
    fetchImpl,
  );
}

export type BusyBlock = { start: string; end: string };

export async function getFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BusyBlock[]> {
  const res = await fetchImpl(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId }] }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      data?.error?.message || "Could not read calendar availability.",
    );
  const calendar = data?.calendars?.[calendarId];
  if (calendar?.errors?.length || !Array.isArray(calendar?.busy))
    throw new Error(
      "Calendar availability could not be verified. Try again later.",
    );
  return calendar.busy;
}

export type CalendarEventInput = {
  eventId?: string;
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  attendeeEmail?: string;
};

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: CalendarEventInput,
  fetchImpl: typeof fetch = fetch,
) {
  const res = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${event.attendeeEmail ? "?sendUpdates=all" : ""}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: event.eventId,
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.startIso },
        end: { dateTime: event.endIso },
        attendees: event.attendeeEmail
          ? [{ email: event.attendeeEmail }]
          : undefined,
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.id !== "string")
    throw new Error(
      data?.error?.message || "Could not create the calendar event.",
    );
  return {
    eventId: data.id as string,
    htmlLink: data.htmlLink as string | undefined,
  };
}

export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const res = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  // 404/410: the event is already gone from Google's side, which is the end state a
  // cancellation wants anyway, so a retry after a prior partial success is a no-op.
  if (res.ok || res.status === 404 || res.status === 410) return;
  const data = await res.json().catch(() => ({}));
  throw new Error(data?.error?.message || "Could not cancel the calendar event.");
}

export async function findCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (response.status === 404) return null;
  const body = await response.json();
  if (!response.ok || body.id !== eventId || body.status === "cancelled")
    throw new Error("Could not reconcile this calendar event.");
  return {
    eventId: body.id as string,
    htmlLink: body.htmlLink as string | undefined,
  };
}
