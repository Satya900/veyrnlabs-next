# Hosted rollout runbook

**Current update (24 September 2026):** this is the historical foundation rollout. Do not rerun migrations that are already applied. Recent booking, billing, WhatsApp connection, worker and member-access changes require migrations 011–015; follow `crm-launch-hardening.md` for the authoritative current behavior and release checks. References below to missing paid-cycle renewal or manual-only number mapping describe the older implementation.

One ordered checklist for applying every pending migration to the real Supabase project, since there is no separate staging project. Each step assumes the previous one is verified and safe before you continue. Do not skip the backup or verification steps to save time; the maintenance-window and backup discipline here is not optional given this is the only project.

This runbook only gets the schema and server-side functions onto the hosted database safely. It does not turn on customer-facing behavior. Keep every `*_ENABLED` flag (`CRM_SIGNUP_ENABLED`, `WHATSAPP_WEBHOOK_ENABLED`, `CRM_AI_ENABLED`, `WHATSAPP_SEND_ENABLED`, `CRM_AUTO_REPLIES_ENABLED`, `RAZORPAY_ENABLED`) off in the real deployment until this runbook is complete, then activate each feature separately using its own `crm-*-rollout.md` activation steps.

## 0. Before you start

1. Confirm what `SUPABASE_URL` in your deployment's environment actually points to. If it is the same project serving `crm.veyrnlabs.com` today, everything below runs against real, currently-used data.
2. Take a full database backup through the Supabase dashboard (Database > Backups) or `pg_dump`. Record the backup's timestamp somewhere you will not lose it.
3. Record baseline row counts for every `crm_*` table, especially `crm_activities` (history is the thing you can least afford to silently lose):
   ```sql
   select 'crm_members' t, count(*) from crm_members
   union all select 'crm_leads', count(*) from crm_leads
   union all select 'crm_clients', count(*) from crm_clients
   union all select 'crm_tasks', count(*) from crm_tasks
   union all select 'crm_activities', count(*) from crm_activities
   union all select 'crm_stages', count(*) from crm_stages
   union all select 'crm_saved_views', count(*) from crm_saved_views;
   ```
4. Confirm all local tests currently pass: `npm run test:crm`, `npx tsc --noEmit`, `npm run lint`, `npm run build`. Do not start against the hosted project if any of these fail.
5. Pick a maintenance window. The organisation migration acquires table locks across every `crm_*` table; plan for real downtime on a production-sized dataset, not an instant cutover.

## 1. Apply the organisation migration

This is the highest-risk step: it rewrites every `crm_*` table to add tenant isolation and backfills all existing rows into one internal organisation.

1. Apply `202609220001_crm_organizations.sql` via the SQL editor, as a single transaction (it already wraps itself in `begin`/`commit`).
2. Re-run the row-count query from step 0.3. Every count must match exactly.
3. Spot-check a handful of specific `crm_activities` rows by ID from before the migration still exist with the same `id`, `lead_id`, and `created_at`.
4. Sign in as the existing internal owner at `/crm/login`. Confirm the workspace loads, search works, saved views load, and a lead can be converted to a client.
5. Submit a real test enquiry through the public contact form and confirm it lands as a Website lead in the internal organisation.
6. Create two throwaway Supabase Auth users (through Supabase Authentication, not the app) and, from a trusted connection using the service-role key, call:
   ```sql
   select crm_provision_organization('TEST-USER-1-UUID', 'Runbook test A', 'Tester A');
   select crm_provision_organization('TEST-USER-2-UUID', 'Runbook test B', 'Tester B');
   ```
7. Sign in as each test owner. Create a lead, a task, and a note in each. Confirm neither test account can see or modify the other's data, or the internal Veyrn workspace's data, through the app or a direct authenticated REST/RPC call.
8. Delete the two test organisations' rows (`crm_members`, then their `crm_organizations` row; leads/clients/tasks/activities/stages cascade or can be deleted first) once verified. Do not leave test tenants in the production project.

If anything in this section fails, stop. Do not proceed to later migrations on a database whose isolation you have not verified.

## 2. Apply invitations and member lifecycle

1. Apply `202609230001_crm_invitations.sql`.
2. Apply `202609240006_crm_member_lifecycle.sql`.
3. In Supabase Auth, enable email/password signup and **Confirm email**. Configure production SMTP and appropriate rate limits.
4. Update the **Confirm signup** email template to show the code: `Your Veyrn CRM verification code is {{ .Token }}`.
5. Update the **Reset Password** email template the same way: `Your Veyrn CRM reset code is {{ .Token }}`.
6. Leave `CRM_SIGNUP_ENABLED` unset or `false` for now; existing member sign-in keeps working regardless.
7. When ready to test (still before flipping the flag on for real customers): set `CRM_SIGNUP_ENABLED=true` in a controlled way (a preview deployment, or a narrow maintenance window), and walk the full checklist in `crm-account-rollout.md` step 7-8 (owner signup, invitation signup, wrong-email/expired/revoked/already-in-another-business cases, owner-vs-admin invitation roles). Then set it back to `false` if you are not ready to launch signup publicly yet.
8. Separately, as the internal owner, test ownership transfer to an admin and back, and removing a team member, following the behavior described in `crm-account-rollout.md`.

## 3. Apply usage budgets

1. Apply `202609230002_crm_usage_budgets.sql`.
2. This activates no subscription and charges nobody by itself. Do not call `crm_open_usage_period` against real organisations until the numbers in `crm-usage-rollout.md` (overhead allocation, AI/WhatsApp allowances) are ones you have actually decided on, not placeholders.
3. Confirm `Settings > Plan & usage` loads without error for the internal workspace (it will show `unconfigured` until a period is opened, which is correct).

## 4. Apply WhatsApp inbound

1. Apply `202609230003_crm_whatsapp_inbox.sql`.
2. Follow `crm-whatsapp-rollout.md` in full: set `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`, map a verified business number to the internal organisation via the documented SQL insert, keep `WHATSAPP_WEBHOOK_ENABLED=false` until the mapping is confirmed correct, then enable it and register the Meta webhook.
3. Send a real inbound test message and confirm exactly one lead and conversation appear in the internal organisation, and nowhere else.

## 5. Apply AI drafts

1. Apply `202609230004_crm_ai_drafts.sql`.
2. Follow `crm-ai-rollout.md`: set `GROQ_API_KEY`, `CRM_AI_PROVIDER`, `CRM_AI_MODEL`, and the two cost-per-million-token rates. Do not set `CRM_AI_ENABLED=true` until you have actually decided the internal workspace's test budget; do not invent production allowances.
3. Generate one test draft against a real inbound message and confirm the reservation, settlement, and cost accounting behave as `crm-ai-rollout.md` describes.

## 6. Apply outbound sending, trial grant, delivery receipts, and auto-replies

Apply in this exact order, each is its own migration:

1. `202609240001_crm_ai_trial.sql`
2. `202609240002_crm_reviewed_replies.sql`
3. `202609240003_crm_trial_replies.sql` (grants the internal workspace's trial allowance only; confirm it did not touch any other organisation)
4. `202609240004_crm_delivery_receipts.sql`
5. `202609240005_crm_auto_replies.sql`

Then follow `crm-outbound-rollout.md` and `crm-auto-replies-rollout.md` for the environment variables and manual-approval-first testing sequence. Leave `CRM_AUTO_REPLIES_ENABLED=false` until reviewed sending has been exercised for real and you are ready to opt a workspace into unreviewed automatic replies.

## 7. Apply Razorpay billing

1. Apply `202609240007_crm_billing.sql`.
2. Follow `crm-billing-rollout.md` in full: create the six Razorpay Plans with the correct
   per-cycle totals, set the webhook secret and per-plan overhead/allowances, and complete its
   test-mode checkout and webhook-replay checklist before setting `RAZORPAY_ENABLED=true`.
3. This is the least-verified integration in this runbook: `crm_apply_billing_webhook`'s event
   dedupe and status parsing have never seen a real Razorpay payload. Do the test-mode checkout
   in step 7 of `crm-billing-rollout.md` before trusting this in production, and re-check that
   doc's payload-shape caveat against Razorpay's current webhook reference at that time.

## 8. Apply the Pro Plus scheduler

1. Apply `202609240008_crm_calendar.sql`, then `202609240009_crm_calendar_unassigned_lead.sql`
   (a same-day fix: an unassigned lead, the default state for every newly created lead, was
   getting the same "Lead unavailable" message used for actual access denial instead of its own
   actionable one).
2. Follow `crm-calendar-rollout.md` in full: confirm the Google Cloud OAuth client's redirect
   URIs cover every host you will use, set `GOOGLE_CALENDAR_CLIENT_ID`/`_CLIENT_SECRET` and a
   fresh `CRM_CALENDAR_TOKEN_KEY`, and complete its connect-and-book checklist against a real
   Google account before relying on this. The OAuth consent screen stays in Testing mode with an
   explicit test-user allowlist until you decide whether to pursue Google's verification review.
3. Losing `CRM_CALENDAR_TOKEN_KEY` after agents have connected calendars makes every stored
   connection permanently undecryptable; back it up like any other production secret before
   agents start connecting.

## 9. Apply AI-driven WhatsApp booking

1. Apply `202609240010_crm_auto_booking.sql` (after both the calendar and auto-replies
   migrations).
2. Follow `crm-whatsapp-booking-rollout.md`: no new environment variables, but confirm you
   understand the tiered design (a clean request against a free slot books automatically;
   anything ambiguous, busy, or missing an assigned agent/connected calendar/Pro Plus entitlement
   hands off to a human) before enabling automatic replies for a workspace that also has a
   connected calendar.
3. Not yet exercised against a real Google account or a real WhatsApp send; only unit- and
   PGlite-tested. Do a live test conversation, in Google's OAuth Testing mode and WhatsApp test
   mode, before relying on this with a real customer.

## 10. After all migrations are applied

1. Re-run the row-count query from step 0.3 one more time against every table (add `crm_organizations`, `crm_invitations`, `crm_subscriptions`, `crm_usage_periods`, `crm_usage_events`, `crm_whatsapp_connections`, `crm_whatsapp_conversations`, `crm_whatsapp_messages`, `crm_ai_knowledge`, `crm_ai_drafts`, `crm_billing_subscriptions`, `crm_billing_webhook_events`, `crm_calendar_connections`). Nothing outside the internal organisation and your deleted test tenants should exist.
2. Confirm normal day-to-day use of the internal workspace (the actual thing this database supports today) still works end to end: sign in, view leads, add a lead, convert a lead, run a report, export data.
3. Keep the backup from step 0.2 until you are confident in this state. Do not treat this runbook as a substitute for a verified restore drill; that is still open work under Phase 5 of `docs/saas-transition.md`.

## Recovery

If any individual migration fails partway, its own `begin`/`commit` transaction rolls back automatically; nothing partial is left behind from that one file. If you discover a problem only after a migration committed successfully, do not attempt to hand-edit policies or drop constraints as a quick fix: restore the backup from step 0.2 and start this runbook over, accounting for any real writes (enquiries, leads) made since that backup.
