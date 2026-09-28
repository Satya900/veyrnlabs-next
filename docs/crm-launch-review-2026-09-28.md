# Launch review — 28 September 2026

Reviewed commit `a2388ea`. The working tree was clean at review start. Application code and hosted services were not changed during this review.

## Decision

Do not open unrestricted paid onboarding yet. The new calendar cancellation flow introduces an authorization/integrity defect, and Pro customers still cannot connect their calendar through the application. These are concrete blockers, not missing optional features.

## Improvements confirmed in the code

- Paid-period checks now govern plan-tier visibility and calendar database access.
- New base checkout is blocked while existing paid access remains, reducing overlapping charges. A true plan-change/proration flow is explicitly still deferred.
- Calendar cancellation and a cancel-then-book rescheduling UI were added.
- Logout now attempts Supabase server-side sign-out.
- Billing webhook errors are logged and the application exposes a support contact.

## Findings

### P1: A team member can directly mark an inaccessible lead's visit cancelled

`supabase/migrations/202609260003_crm_visit_cancellation.sql:57–70` exposes `crm_finish_visit_cancellation` to every authenticated user. It checks organization membership but not lead access, and requires no server-side completion proof. A caller can bypass the application route and Google deletion entirely.

Reproduced using all migrations in PGlite: an authenticated team member had `crm_lead_access(lead) = false`, yet directly calling the completion RPC changed that lead's booking from booked to cancelled. No Google API request occurred. This also releases the internal conflict reservation while the real event can remain on Google.

Make completion service-only, recheck authorized actor/lead access, and bind it to a cancellation attempt so overlapping booking/cancellation requests cannot finalize stale work.

### P1: Cancellation can target the wrong agent's calendar after reassignment

`supabase/migrations/202609260003_crm_visit_cancellation.sql:53` obtains credentials from the lead's current owner using `crm_calendar_connection_for_lead`, rather than the booking's recorded member/calendar. If agent A booked the event and the lead is reassigned to B, cancellation uses B's calendar. `deleteCalendarEvent` treats 404 as success, allowing the CRM to record cancellation while A's event remains.

Resolve the event's original calendar identity, while authorizing the caller against current lead permissions. Persist the calendar identity on the booking to handle later calendar reconnection as well.

### P1: Pro manual scheduling is still blocked by the OAuth entry route

`src/app/api/crm/calendar/connect/route.ts:30` still requires `pro_plus`. The newer SQL permits paid Pro, and pricing promises manual scheduling to Pro. A new Pro customer cannot reach calendar authorization. Update the route and calendar settings copy; retain the separate Pro Plus requirement for automatic booking.

### P2: Cancel and change-time actions fail immediately after creating a visit

`src/components/crm/ScheduleVisit.tsx:109` sets the new visit's `booking_id` to an empty string. The subsequent workspace reload does not refetch that local visit state; its fetch effect depends only on leadId. Clicking Cancel visit or Change time then submits an invalid booking ID until the component is remounted.

Return the booking ID from the booking endpoint or reload the visit resource before enabling these actions. Add a browser/API contract test for book-then-cancel without refreshing the page.

### P2: Rebooking a cancelled slot reuses the old external event ID

`supabase/migrations/202609260003_crm_visit_cancellation.sql:26` resets status/member on conflict but retains the old event ID. Reproduced locally: reserve, cancel, reserve the same slot returns the identical event ID. A new attempt should receive a new external event identity after a confirmed cancellation, while retries of an uncertain attempt retain their original identity. Google-side acceptance of the reused deleted identity was not live-tested.

### Session revocation needs narrower claims and verification

`src/app/api/crm/session/route.ts:87–95` claims a captured token cannot continue working after logout. The installed Supabase SDK documentation states that sign-out revokes refresh tokens while access JWTs remain valid until expiry. Application requests call getUser, but direct database access also needs consideration. The route also ignores the returned signOut error object; catching exceptions alone does not establish successful revocation.

Verify revoked-session behavior through both application routes and direct RLS-protected API calls. Handle provider error results and document the actual access-token lifetime instead of treating admin sign-out as immediate universal JWT invalidation.

## Verification and limits

- CRM suite: 134 tests passed, zero failed.
- TypeScript: passed.
- ESLint: passed.
- Production build: passed with network access for Google Fonts.
- Targeted isolated SQL reproduced the direct-cancellation authorization bypass and event-ID reuse.
- Hosted migrations, production secrets, live provider approvals, worker schedules, backups, and real two-company end-to-end operation were not verified. Local success does not certify those deployment requirements.

Before public launch, fix the P1 findings, verify cancellation and rescheduling without page refresh and after lead reassignment, then complete the two-business staging journey with provider test mode. Do not describe the still-deferred subscription-change flow as a working self-service upgrade.
