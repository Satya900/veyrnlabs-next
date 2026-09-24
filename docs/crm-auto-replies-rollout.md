# Opt-in automatic replies

**Updated operations:** `crm-launch-hardening.md` supersedes the local-only worker and manually scoped credential instructions below. The Render worker targets Vercel, processes company-scoped connections, records health, and exposes operator reconciliation. Apply migrations 011–015 before deploying the updated routes.

Apply `202609240005_crm_auto_replies.sql` after the receipt migration. The migration enables no workspace and sends nothing. Both Pro and Pro Plus can use the same assistant within their allowances. A clean, unambiguous site-visit request is booked automatically on top of this same job as of `202609240010_crm_auto_booking.sql`; see `crm-whatsapp-booking-rollout.md`.

Activation requires all of these:

- AI provider and scoped WhatsApp sending configuration already working.
- An active AI and messaging allowance. Automatic sends share existing quotas and cost accounting; no extra allowance is granted.
- `CRM_AUTO_REPLIES_ENABLED=true` and a server-only random `CRM_WORKER_SECRET` of at least 32 characters, followed by a server restart.
- A running worker. Locally, `npm run crm:worker` polls the protected localhost endpoint every three seconds, one job at a time. It must remain running alongside Next and ngrok. Production needs a managed scheduler/worker invoking `POST /api/internal/crm/auto-replies` with `Authorization: Bearer <CRM_WORKER_SECRET>`. Keep the secret out of URLs, browser variables and logs. The UI readiness indicates configuration, not worker health.
- An owner/admin explicitly selects **Enable automatic replies without review** in Settings. Only incoming messages after opt-in are queued; no historical replay.

Jobs live in Supabase, not process memory. Rapid messages supersede older queued work. Claims are exclusive; processing jobs are never automatically reclaimed for another provider call. Five-minute abandoned claims are marked failed and pause their conversation. Queued jobs older than five minutes require human attention. A provider/network crash keeps reservations for reconciliation. The local runner's next poll does not resend an uncertain job. Recent job status/reasons are visible in Settings; an operator reconciliation UI and heartbeat alerting are still needed for an unattended production service.

Before generation and sending, SQL checks the opt-in actor still belongs to the organization as owner/admin, knowledge version, current source message, takeover flag, connection scope, reply window and shared usage budgets. Previously accepted outbound messages are included in bounded context. Disabling drafts disables automatic replies too. Changing knowledge invalidates in-flight jobs. Turning automation off cancels queued work. Requests already dispatched to Meta cannot be recalled; pause prevents future dispatches once the database check observes it.

Human requests, common English stop/unsubscribe wording and non-text messages pause the conversation. The model's human-review flag, malformed replies, long replies or more than two question marks also prevent automatic sending. A booking request with an ambiguous, out-of-hours or already-past date/time also forces human review, with the extracted date/time (when any) stored on the draft for one-tap confirmation. These are conservative checks, not a complete multilingual consent engine or a guarantee against hallucinations. A human must review and resume paused conversations. Existing opt-out history still blocks sending even if AI is resumed.

Test with the internal test number and fictional knowledge first: opt-in off creates no jobs; enabled plus a new enquiry creates one reply; repeated webhook delivery creates no duplicate; pause/disable prevents new replies; read receipts update history. All automated repository tests mock external APIs and send no real messages.
