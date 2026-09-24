# Pro Plus scheduler: first release

**Updated implementation:** apply migration 011 and the remaining launch migrations following `crm-launch-hardening.md`. Both booking paths now reserve the agent/time in Postgres, recheck availability and use stable Google event IDs. CRM activity and follow-up completion is atomic. Team members can connect their own calendar. The first-release record below predates this hardening.

Apply `202609240008_crm_calendar.sql` after the usage budgets and trial migrations. Run
`npm run test:crm`, `npx tsc --noEmit`, and `npm run lint` before rollout. The migration
activates nothing and connects no calendar.

## Scope of this release

Each agent connects their own Google Calendar. Owners/admins with lead access can then check
that agent's real availability and book a site visit from a lead's detail view; Google Calendar
creates the event, sends the invite if the lead has an email, and Veyrn CRM logs the booking as
a lead activity. "Automatic" here means synced and conflict-checked against a real calendar, not
AI-autonomous: nothing books itself without a human picking the slot. Deliberately out of scope:

- **AI-driven booking over WhatsApp.** The next release layers this on top of the same
  connection/availability infrastructure built here; it is not part of this one.
- **Editing or cancelling a booked visit from the CRM.** Once booked, changes happen in Google
  Calendar directly; the CRM does not yet reflect cancellations or reschedules made there.
- **Anything beyond a single connected calendar per agent**, and no support for an agent
  belonging to more than one organisation (matching the rest of this codebase's one-workspace
  model).
- **Verified/published OAuth consent.** The Google Cloud project is in Testing mode with an
  explicit test-user allowlist. Publishing requires Google's verification review, since
  `calendar.events` is a sensitive scope; do not add real customers as calendar users before
  that review completes, or before deciding whether verification is even required for your
  launch shape.

## Data model and credential handling

`crm_calendar_connections` stores one row per member: `calendar_id` (always `"primary"` in this
release) and an AES-256-GCM-encrypted refresh token, encrypted in the application layer before
it ever reaches the database using a server-only `CRM_CALENDAR_TOKEN_KEY`. The table has zero
grants to `authenticated`; every read or write goes through a `security definer` function that
enforces its own tenancy and role checks:

- `crm_save_calendar_connection`: the agent connects their own calendar. Requires the caller's
  organisation to hold an active Pro Plus subscription.
- `crm_calendar_status`: returns only the caller's own connected/not-connected state, never the
  token.
- `crm_calendar_connection_for_lead(lead)`: the server-only bridge used by the slots and
  booking routes. Re-checks lead access and the active-Pro-Plus entitlement independently of
  whatever the client claims, then returns the lead owner's encrypted token for that one request.
  The decrypted token is used once, server-side, and never sent to the browser. An unassigned
  lead (`owner_id is null`, the default state for every newly created lead) raises a distinct
  "Assign this lead to an agent before scheduling a site visit" error rather than being folded
  into the same "Lead unavailable" message used for actual access denial
  (`202609240009_crm_calendar_unassigned_lead.sql`).
- `crm_disconnect_calendar`: removes only the caller's own connection.

Losing `CRM_CALENDAR_TOKEN_KEY` makes every stored connection permanently undecryptable; there
is no recovery path except every agent reconnecting. Back it up the same way you would any other
production secret.

## OAuth flow

`GET /api/crm/calendar/connect` checks the org's entitlement via `crm_usage_summary`, then
redirects to Google with `access_type=offline` and `prompt=consent` so a refresh token is
issued even on a reconnect. CSRF state is carried in a short-lived, `SameSite=Lax` cookie
(`Lax`, not `Strict`, since the callback arrives as a cross-site top-level navigation from
Google). `GET /api/crm/calendar/callback` verifies the state, exchanges the code, encrypts the
refresh token, and saves it using the signed-in agent's own session, not a service-role call.
Both routes construct the redirect URI from the request's own `Host` header, so the same code
works against the production host and an ngrok tunnel without a config flag, as long as both are
registered as authorized redirect URIs on the OAuth client.

## Booking flow

`GET /api/crm/calendar/slots?leadId=&from=&to=` returns only Google's busy blocks for the
requested range; the browser's own UI (`ScheduleVisit.tsx`) builds the candidate slot grid
(currently a fixed 09:00-18:00 IST business day, 30-minute increments) and subtracts the busy
blocks itself, keeping the server endpoint a thin, easily-tested passthrough. The grid also
disables any slot that has already passed (the booking route always rejects a past start time;
without this the grid would show hours already gone by as clickable whenever viewed partway
through the day). `POST
/api/crm/calendar/book` re-resolves the connection (never trusts a slot the client claims was
free), creates the Google Calendar event, invites the lead's email if it looks valid, logs a
`meeting`-kind activity on the lead, and sets the lead's `follow_up` to the visit start time. It
does not change the lead's pipeline stage; stage changes stay a deliberate, separate action.

## Activation steps

1. Apply `202609240008_crm_calendar.sql`, then `202609240009_crm_calendar_unassigned_lead.sql`.
2. In Google Cloud Console, confirm the Calendar API is enabled, the OAuth consent screen has
   both `calendar.events` and `calendar.freebusy` scopes, and the Web application OAuth client's
   authorized redirect URIs include every host you will test or deploy from, each ending in
   `/api/crm/calendar/callback`.
3. Set `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, and a fresh random 32-byte
   hex `CRM_CALENDAR_TOKEN_KEY`.
4. While the consent screen is in Testing mode, add every account that will test this as a test
   user under Audience settings; Google rejects the OAuth flow for anyone else.
5. As an agent in an organisation with an active Pro Plus subscription, connect a calendar from
   Settings, confirm the connected state persists, then open a lead you own and confirm the slot
   grid reflects real busy time on that calendar before booking a real test event.
6. Confirm booking creates the activity log entry and sets `follow_up`, and that disconnecting
   removes access (a subsequent slots/book call for that agent's leads fails with a clear error,
   not a stale success).

## Test coverage and limits

`npm run test:crm` covers: role/tenancy/entitlement enforcement on all four calendar RPCs
(including that a non-entitled organisation is rejected independently of whether the lead
belongs to it, and that an unassigned lead fails with its own distinct message), that
reconnecting updates rather than duplicates a connection, that status never exposes the token,
and the pure Google API/crypto helpers (authorize URL shape, token exchange, free/busy, event
creation, and that a tampered ciphertext fails to decrypt) against fabricated responses with an
injected fetch implementation.

Exercised live end to end (2026-09-24): a real Google account completed the OAuth consent flow
and connected; a real lead, assigned to that agent, was booked into a real free slot from the CRM
UI; the resulting event was confirmed present on the connected Google account's own calendar at
the correct time. The unassigned-lead and past-slot fixes above were both found and fixed during
this live run, not by the automated test suite alone. Not yet exercised live: disconnecting a
calendar and confirming subsequent slots/book calls fail cleanly (step 6 above), and the
verified/published OAuth consent path.
