# Groq provider setup

Use CRM_AI_PROVIDER=groq, CRM_AI_MODEL=openai/gpt-oss-120b and a server-only GROQ_API_KEY from https://console.groq.com/keys. OpenRouter is no longer supported. Existing keys are not transmitted to Groq. No database migration is required.

Input/output budget estimates are 2000/8000 INR paise per million tokens (20/80 rupees), conservative accounting estimates rather than a claim about actual Groq billing. Review these against your invoice and exchange rate. Free-tier requests still consume allowance units and estimated cost budget. Rate limits apply; no automatic provider fallback or retry. Company knowledge and an active usage period remain required.

# AI reply drafts: first release

Apply `supabase/migrations/202609230004_crm_ai_drafts.sql` after the WhatsApp inbox migration. Existing incoming messages and connections remain intact. The migration activates no AI, sends nothing and creates no paid subscription.

## Customer workflow

An owner/admin opens Settings > AI assistant knowledge, adds company and property facts (maximum 12,000 characters), and enables reply drafts. Team members can generate drafts only for conversations attached to leads they can access. The model sees the company knowledge and at most eight recent inbound text messages (1,500 characters each). No cross-company context, access tokens, contact phone numbers or internal margin details are included. Drafts must be reviewed for accuracy; company knowledge is not a guarantee against model hallucinations.

Open WhatsApp > conversation > Generate reply draft. Take over / pause AI disables new generation for that conversation. An in-flight result is withheld if handover happens, AI settings are disabled, or a newer message arrives before completion. Stop/unsubscribe and common human-request phrases are blocked before generation; the model also flags human attention. This is an initial English keyword check, not a complete multilingual opt-out system.

**This release produces reviewable drafts only.** It does not send messages, book appointments, invoke tools, automatically update qualification fields, or generate on inbound webhook delivery. Both Pro and Pro Plus may use drafts within their configured AI allowance. The model never books anything itself on either plan; see `crm-whatsapp-booking-rollout.md` for the later, separate layer that extracts a candidate date/time from the conversation and lets deterministic server code check real availability and book.

## Provider activation

Server-only variables in `.env.crm.example`:

- `GROQ_API_KEY`: server-only Groq key. `OPENAI_API_KEY` is used only if switching to the OpenAI provider.
- `CRM_AI_PROVIDER=groq` and `CRM_AI_MODEL=openai/gpt-oss-120b`: current structured-output configuration.
- `CRM_AI_INPUT_PAISE_PER_MILLION` / `CRM_AI_OUTPUT_PAISE_PER_MILLION`: positive integer, all-in INR cost per million tokens. Include currency conversion and applicable fees. Rates are operator-controlled, not customer-editable.
- `CRM_AI_ENABLED=true`: turn on only after rates, knowledge and plan allowances have been configured.

The organization must have an active usage period from the previous billing migration. Do not assign invented production allowances or pretend the internal Veyrn workspace has a paid subscription. Decide the explicit test/paid budget first. Missing config or allowance fails closed before a provider call.

## Cost accounting and failure behavior

Each unique source message reserves one AI unit and a conservative maximum cost atomically. The reservation uses 110,000 input tokens as an upper estimate for 12,000 UTF-16 knowledge characters plus eight 1,500-character messages, JSON, instructions and schema; generation is capped at 700 output tokens. Confirm this bound for the selected model/tokenizer before activation. Actual returned token usage is settled at configured rates, rounded up to paise; cached inputs are conservatively charged at the regular input rate. No hosted tools are enabled. The existing 70% total-cost ceiling and overhead allocation apply.

Duplicate clicks reuse the stored attempt without another API call. The request performs one synchronous provider call with a 25-second timeout; there is no hidden retry. A crash/timeout/unknown usage retains its reservation and the attempt must be reconciled by an operator. The same customer message will not automatically be charged again. Incomplete/refused/malformed output with known usage settles the incurred cost and requires human attention. Reservation overruns are recorded by the existing ledger, which blocks later work at its ceiling.

If the server stops between provider success and database completion, a draft may remain `generating`. Treat it as an unresolved attempt; investigate provider usage before settling or cancelling through the service-only ledger. Do not reset status or rerun blindly. A production unattended system still needs a durable worker queue, reconciliation and alerts.

Groq uses Chat Completions with strict structured output and no tools. The optional OpenAI adapter uses the Responses API with `store:false`. This disables Response object storage; it is not a claim of zero data retention for all provider processing. References: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Responses migration and storage](https://developers.openai.com/api/docs/guides/migrate-to-responses).

## Next stage

Reviewed outbound sending, encrypted per-company Meta credentials, template/24-hour-window enforcement, persistent opt-outs, status callbacks, delivery reconciliation, and then opt-in automatic replies through a durable queue. Keep the current test-number credentials scoped to the internal test workspace; they are not a multi-tenant sending solution.

