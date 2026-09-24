# CRM launch hardening — 24 September 2026

This document supersedes older rollout notes where they describe billing renewal, manual WhatsApp mapping, booking safety, or worker deployment. Code changes here require migrations 011–015; they have been tested locally but have not been applied to hosted Supabase by this task.

## Apply in order

1. `202609240011_crm_booking_integrity.sql`
2. `202609240012_crm_paid_cycles.sql`
3. `202609240013_crm_connections_worker.sql`
4. `202609240014_crm_reconciliation.sql`
5. `202609240015_crm_member_access.sql`

Take a database backup and apply these after all migrations through 010. Deploy the corresponding application after the migrations. Old paid webhook activation is revoked by 012; coordinate webhook/application deployment in the same window. Webhooks that receive 503 must be replayed after deployment. Do not rerun already-applied historical migrations.

## Booking

Manual and automatic booking reserve an agent/time interval in Postgres. A repeated request does not create a second event, and overlapping CRM reservations are rejected. The manual endpoint rechecks Google free/busy immediately before insertion. Individual-calendar errors fail closed. Stable Google event IDs allow a successful event to be recovered after a network or database failure. CRM meeting activity and lead follow-up are committed atomically after Google confirmation.

Automatic booking rechecks human takeover, latest customer message, knowledge version, actor authority, paid Pro Plus access, and calendar ownership before reserving. It never retries an uncertain Google write. Staff should reconcile the event before booking another slot. Google writes performed outside the CRM can still race between a free/busy read and insertion; Google does not offer a transaction spanning those calls. External cancellations/reschedules are not yet synchronized back into CRM reservations.

## Billing and seats

Charges must contain a captured payment ID, exact plan/currency/amount, and provider cycle dates. A charge creates all monthly allowance periods for the paid cycle in one transaction. Quarterly/annual access therefore continues without a monthly renewal cron. Payment/cycle uniqueness prevents differently serialized webhook replays from resetting usage. Out-of-order status events do not overwrite a newer status.

Current subscriptions created by the earlier release need their latest genuine `subscription.charged` webhook replayed after this migration. Existing first-period usage is preserved; remaining prepaid periods are added. Review resulting boundaries before launch. No guessed paid-through dates or invented payment records are used.

Create `RAZORPAY_PLAN_EXTRA_SEAT`: INR 500, monthly interval 1, amount 50000 paise. Seats bill monthly without duration discounts, independently of the base plan. The owner chooses quantity and approves Razorpay Checkout. Seat allowances increase only on captured payment and expire at the paid-through date. They never increase AI/message limits. Removal of a member does not cancel billing: cancellation is a separate owner action in Settings. Existing members are not deleted when seats expire; the owner retains access and additional members beyond the allowance lose access, ordered by join time with a stable ID tiebreaker. Renew seats or remove unused memberships to restore access. Historical member IDs remain on replies, invitations, jobs and bookings after removal.

Abandoned `created` checkouts can be resumed or cancelled from Settings. Checkout creation is reserved in the database before calling Razorpay to prevent duplicate requests. An uncertain creation remains held for operator reconciliation using the `crm_attempt_id` note in Razorpay. Never blindly create another subscription after a timeout. Plan upgrades/downgrades remain an assisted operation; cancellation of renewal is now self-service.

## Customer WhatsApp connection

Set `META_APP_ID`, `META_WHATSAPP_CONFIG_ID`, `META_GRAPH_VERSION` and a separate random 32-byte hex `CRM_WHATSAPP_TOKEN_KEY`. Preserve the encryption key in your secret backup. Keep `WHATSAPP_APP_SECRET` configured for the same Meta app. Global webhook/send flags and conservative reply cost must also be configured.

Settings → WhatsApp connection → Manage connection → Connect with Meta launches Embedded Signup. Complete Meta authorization, then Finish connecting. New Cloud API numbers can be registered with their six-digit PIN. Existing registered numbers omit the PIN. The server exchanges the authorization code, validates the app/token permissions and WABA/phone relationship, subscribes the WABA webhook, and saves the token encrypted in a table inaccessible to browser sessions. Tokens are checked for known expiry on each send; reconnect to renew authorization. A company's existing number cannot be replaced in place because historical conversations belong to that connection. Disconnect pauses automation and removes stored credentials without deleting history.

Meta account prerequisites remain external: verified business/Tech Provider setup, an Embedded Signup configuration, approved permissions for other businesses, published app, SDK domains/redirect URIs, and the HTTPS messages webhook. This flow has mocked tests but still requires a real authorized customer-number onboarding test. Existing scoped internal `.env` credentials continue to work only for their matching active connection.

## Vercel + Render worker

Use the `render.yaml` background-worker blueprint. It needs `CRM_WORKER_BASE_URL=https://YOUR-VERCEL-PRODUCTION-HOST` and the same `CRM_WORKER_SECRET` as Vercel. It requires no Supabase, AI, Google, or Meta secrets: all processing remains in the protected Vercel endpoint. Run `npm run crm:worker`; the process polls one queued job at a time across companies, backs off on errors, and exits after five failures so the managed host can restart it. Configure Render failure notifications and an authenticated uptime check for the health endpoint.

`GET /api/internal/crm/auto-replies` with `Authorization: Bearer <CRM_WORKER_SECRET>` returns HTTP 503 for missing/stale/error heartbeat, plus recent jobs needing attention and stale usage reservations. A healthy heartbeat returns 200. Settings shows worker health without exposing internal costs or the secret. Vercel must support the route's configured 120-second maximum duration. No worker service was purchased or deployed by this task.

## Reconciliation

`POST /api/internal/crm/reconcile` uses the same bearer authentication; keep it strictly operator-only.

- Booking: JSON `{ "kind": "booking", "bookingId": "UUID" }` looks up the stable Google event ID and completes the CRM record only if Google confirms the event. A missing event retains the reservation for review; it never triggers another insert.
- Usage: JSON `{ "kind": "usage", "organizationId": "UUID", "eventId": "UUID", "cost": 123, "cancelled": false, "evidence": "Provider invoice or request reference" }` settles INR paise from verified provider evidence and records an audit entry. Set `cancelled: true, cost: 0` only after verifying that no billable request occurred. Reconciliation never resends messages or automatically resumes paused conversations.

## Release verification

Local tests cover all migrations, tenant restrictions, permission denial, prepaid contiguous months, payment replay, exact price validation, paid seats, conflicting/repeated bookings, atomic meeting history, token encryption and asset mismatch. Before enabling public sales, complete Razorpay test checkouts for monthly/quarterly/annual and seats, replay their webhook, cancel an abandoned checkout, test a team member's Google connection, run one automatic visit conversation, and onboard an authorized second business's WhatsApp number. No real charge, message, calendar event, cloud deployment, or hosted migration was performed as part of these local hardening tests.

Provider references: [Razorpay subscription webhooks](https://razorpay.com/docs/webhooks/subscriptions/), [Google event insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Google free/busy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), [Meta's reference Tech Provider app](https://github.com/fbsamples/business-messaging-sample-tech-provider-app), [Render background workers](https://render.com/docs/background-workers).
