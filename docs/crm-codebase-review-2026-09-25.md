# CRM codebase review — 25 September 2026

Reviewed commit: `af33abb` (clean working tree at the start). This is a review, not an implementation or production certification. No application code or migrations were changed. No real email, WhatsApp message, payment, or calendar event was sent.

## Overall assessment

The repository now contains a substantial real estate SaaS foundation: authenticated organizations, roles and invitations, leads and clients, tasks and activities, WhatsApp ingestion and delivery receipts, reviewed and automated AI replies, calendar bookings, subscriptions and paid seats, usage budgets, customer WhatsApp connection, and background processing. The latest changes add click-to-chat links, a GitHub Actions worker, and automatic email follow-ups through Resend.

The new follow-up flow is not ready to enable for customers. It has a blocking application/database contract mismatch and lacks several protections already present in the WhatsApp automation. Passing unit tests do not establish that the deployed flow works.

## Findings, ordered by priority

### 1. P1 — Automatic email follow-ups fail before dispatch

- `src/lib/crm/followup-worker.ts:85` sends `channel: "email"` to `crm_prepare_followup_send`.
- `supabase/migrations/202609250001_crm_followups.sql:148` declares the argument as `requested_channel`.
- Supabase RPC resolves named parameters; it cannot match this call. AI generation can consume usage before the request fails. The job remains processing until maintenance marks it failed, and the same follow-up timestamp cannot be claimed again.
- Reproduced against the complete migration chain using named SQL arguments: `function crm_prepare_followup_send(... channel => unknown ...) does not exist`.
- Fix the parameter contract and test the actual worker against database-backed RPC argument names. Existing SQL tests invoke this function positionally, hiding the mismatch.

### 2. P1 — Disabling automation does not stop an already-claimed follow-up

- `supabase/migrations/202609250001_crm_followups.sql:148–164` checks job status, lead conversion, and follow-up timestamp before sending, but does not recheck enabled settings, drafts permission, settings version, actor authority/seat access, current open stage, recent human activity, or claim age.
- `settings_at` is saved on the job but never compared during dispatch.
- Reproduced: claim a job, finish a draft, call `crm_set_followups(false)`, then prepare the email. The function still returns `run: true` and reserves email cost.
- Once finding 1 is fixed, a worker could send after the administrator disabled it, an agent contacted the lead, or the lead moved to Lost without changing its follow-up date.
- Revalidate authorization, settings, and eligibility immediately before dispatch; invalidate pending jobs when automation is disabled.

### 3. P1 — One tenant with exhausted or inactive usage can block every tenant's follow-ups

- `supabase/migrations/202609250001_crm_followups.sql:123–130` selects the oldest eligible lead globally, then reserves AI usage before inserting its job.
- If the subscription is inactive, the period expired, or the budget is exhausted, the reservation raises an exception. The transaction rolls back, leaving that same lead eligible and oldest. Every later worker run selects it again instead of progressing to another company.
- Reproduced two consecutive calls returning `Subscription inactive` with no new job persisted for the blocked lead.
- Isolate claim failures per tenant/lead and persist a blocked/review state or retry deadline. Add a two-tenant regression test showing that the healthy tenant still progresses.

### 4. P1 — Uncertain AI costs are cancelled instead of held for reconciliation

- `supabase/migrations/202609250001_crm_followups.sql:141` calls `crm_finish_usage(..., coalesce(actual_cost_paise,0), actual_cost_paise is null)`.
- The final argument means cancel. The worker passes null after a provider timeout or unknown outcome, so a potentially billable request disappears from reserved spending despite the message saying reconciliation is required.
- Reproduced: a 100-paise reservation becomes `cancelled` with null actual cost after uncertain completion.
- Preserve the reservation when the outcome is unknown, as the WhatsApp AI flow does. Cancel only when there is evidence that no cost was incurred. This matters directly to the 70% cost ceiling.

### 5. P1 — Legacy paid subscriptions cannot be repaired using the documented identical-webhook replay

- `supabase/migrations/202609240012_crm_paid_cycles.sql:85–86` returns immediately if the webhook hash already exists.
- The earlier billing implementation used the same receipt table. Therefore a byte-identical previously processed charge never reaches the new paid-cycle insertion or quarterly/annual period backfill.
- `docs/crm-launch-hardening.md:25` currently instructs operators to replay that historical charge to create missing future months. That repair can silently do nothing while the webhook returns success.
- Provide a controlled backfill/reconciliation path that validates the genuine captured payment, preserves existing spending, and distinguishes old receipts from fully applied new paid cycles. Test an upgrade fixture with an existing receipt and only the original usage period.

### 6. P2 — Customer replies and WhatsApp handover do not suppress email nudges

- Follow-up eligibility at `supabase/migrations/202609250001_crm_followups.sql:122` considers only activity kinds `note`, `call`, `meeting`, and `task`.
- It does not inspect recent inbound WhatsApp messages or conversation pause/stop state. The email AI receives lead details and notes, not conversation history. A reply to the business is therefore not sufficient to stop a "gone quiet" email.
- The settings UI describes leads with "no reply", which is broader than what the query actually establishes.
- Define a shared contact/suppression rule, check new interactions both at claim and dispatch, and accurately describe the eligibility in the UI. Do not rely on the model inferring a stop request that is absent from its input.

### 7. P2 — The documented Render worker never processes email follow-ups

- `render.yaml` launches `npm run crm:worker`.
- `scripts/crm-auto-worker.mjs:14` targets only `/api/internal/crm/auto-replies`; the loop never calls `/api/internal/crm/follow-ups`.
- A deployment following the Render runbook can successfully handle WhatsApp while leaving every automatic email untouched.
- Add independent polling for both queues or deploy explicitly separate workers, and expose health separately for each.

### 8. P2 — GitHub worker cadence, health checks, and failure handling disagree

- `.github/workflows/crm-worker.yml:5` schedules every five minutes, but health checks treat the worker as stale after two minutes (`src/app/api/crm/followups/route.ts:16`, and both internal worker health routes).
- Consequently a functioning scheduled worker reports unhealthy for much of its normal interval.
- The workflow executes both endpoint calls sequentially under a three-minute job limit; each curl can wait 130 seconds. A slow first call can cause the second to be interrupted. A failed first step also skips the follow-up step by default.
- Each endpoint processes only one job per invocation: the scheduled configuration has a nominal ceiling of 12 jobs/hour per queue across all companies, before delays or failures.
- Align health with deployment mode, isolate the queues' failures/timeouts, and document capacity and expected response latency. This schedule should not be presented as immediate WhatsApp response processing.

### 9. P2 — Follow-up history reintroduces member-removal failures

- `supabase/migrations/202609250001_crm_followups.sql:44,49` introduces direct foreign keys from settings and historical jobs to `crm_members`, with the default NO ACTION deletion behavior.
- Migration 015 previously removed historical membership dependencies and added departure cleanup, but that cleanup does not include follow-ups added by the later migration.
- An admin who enabled follow-ups or owns a historical job cannot subsequently be deleted by the member-removal flow without clearing those dependencies. Historical jobs continue to block deletion even after the setting is disabled.
- Preserve actor IDs as audit history; clear active follow-up ownership and disable/cancel pending work when a member leaves. Cover this with a lifecycle test after all migrations, not only the older subset.

### 10. P2 — Previously paying customers have no self-service reactivation path

- `src/components/crm/PlanUsage.tsx:92` renders only a support message when there is no active usage period.
- The plan selector appears for unconfigured subscriptions or trials, not expired paid periods. `BillingManage` only resumes created checkouts or cancels subscriptions.
- The unconfigured branch also omits `expired` from the terminal statuses that allow checkout, even though `crm_begin_checkout` permits a new checkout for that status.
- Render plan selection for terminal subscriptions with no active paid period, while keeping active/pending subscriptions protected from duplicate checkout.

## Verification performed

- `npm run test:crm`: **130 passed, 0 failed**.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed on retry with network access. The sandboxed attempt failed only when fetching Geist fonts from Google.
- All SQL migrations applied successfully to isolated PGlite databases during the tests and targeted audit checks.
- Additional isolated SQL checks reproduced findings 1–4 and inspected the foreign-key behavior behind finding 9. Other findings are based on the cited control flow/configuration.
- No hosted Supabase migration status, production secrets, provider approvals, deployed worker health, real second-tenant onboarding, or real payment delivery was verified in this review.

## Why the suite remains green

The follow-up database test calls RPCs positionally and the email transport test mocks Resend. Neither executes `processFollowUp` through a named-argument database adapter. Coverage also lacks disabled-after-claim, unknown-generation-cost retention, blocked-oldest tenant fairness, post-follow-up member removal, and old-billing-receipt upgrade cases. These are integration/state-transition gaps rather than TypeScript errors.

## Recommended implementation order

1. Repair and integration-test the worker/RPC contract, dispatch revalidation, and unknown-cost handling together before enabling automatic emails.
2. Make queue progress independent of another tenant's budget or subscription failure; wire both worker deployment options correctly.
3. Add shared interaction/suppression checks and repair member departure handling.
4. Repair billing backfill and reactivation, then run captured-payment upgrade tests.
5. Run hosted staging checks with two organizations, real test-mode providers, worker failure/restart, and a full paid billing cycle transition.

Later product scope remains: configurable company time zones/business hours (currently IST), property inventory and matching, calendar cancellation/rescheduling synchronization, session refresh, and complete customer data deletion. These are separate from the regressions above. A successful build or local ledger ceiling alone does not prove a 30% operating margin; actual provider costs and overhead still need measurement.
