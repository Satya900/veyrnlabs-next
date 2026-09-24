# WhatsApp inbound integration

## Apply and configure

1. Apply `supabase/migrations/202609230003_crm_whatsapp_inbox.sql` after the previous CRM migrations. It activates no connections and sends no messages.
2. In your server environment, set `WHATSAPP_APP_SECRET` to the Meta app secret and `WHATSAPP_VERIFY_TOKEN` to a long randomly generated secret you choose. Never use a `NEXT_PUBLIC_` prefix or paste these secrets into chat. Keep `WHATSAPP_WEBHOOK_ENABLED=false` until the number mapping is correct.
3. Using a trusted operator account in Supabase, map a verified business asset to the correct CRM organization. The phone number ID is Meta's ID, not the displayed telephone number. Check ownership through Meta before mapping it; customers cannot claim arbitrary number IDs in the CRM.

```sql
-- Replace every placeholder. Verify organization and Meta business ownership first.
insert into public.crm_whatsapp_connections
  (organization_id,waba_id,phone_number_id,display_phone,active)
values
  ('YOUR-ORGANIZATION-UUID','YOUR-WABA-ID','YOUR-PHONE-NUMBER-ID','+91 YOUR NUMBER',true);
```

4. Set `WHATSAPP_WEBHOOK_ENABLED=true` and deploy/restart. In your Meta app, register the public HTTPS callback `https://YOUR-CRM-HOST/api/webhooks/whatsapp`, entering the same verify token. Subscribe to the WhatsApp `messages` field and the intended WABA through Meta's configuration. Localhost alone is not reachable by Meta; use a deployed HTTPS host or an explicitly configured development tunnel.
5. Send an inbound test message from your own phone, then open CRM > WhatsApp and refresh. Check that exactly one lead and conversation were created in the intended organization. Assign the lead to a teammate to check team access. Do not enable customer outbound traffic during this phase.

## Behavior

- Admins can refresh the inbox to check business-number mapping, server receiver readiness and the last stored inbound message. Readiness does not claim Meta subscription or live delivery has been verified; an actual inbound test is still required. No secret values are returned.

- GET verifies the challenge; POST verifies HMAC-SHA256 against the exact raw request body before parsing. Payloads are bounded to 1 MiB and 500 messages.
- Only active mappings matching BOTH WABA ID and phone number ID ingest events. Unknown/paused mappings are acknowledged and ignored; add mappings before subscribing. Pausing ingestion does not queue missed messages for later replay.
- Every batch is stored transactionally; storage errors return 503 so Meta may retry. Message IDs deduplicate within a company. Connection locks serialize concurrent first messages, preventing duplicate leads. A malformed signed batch returns 400 and needs investigation; payloads and secrets are not logged.
- The first message from a contact creates one unassigned WhatsApp lead and one conversation; later messages reuse it. It does not merge an existing manually created lead with the same phone number. A valid open pipeline stage is required. Older webhook deliveries do not move a conversation's latest timestamp backward.
- Text is displayed verbatim as escaped React text. Interactive/button selections and media captions can be shown. Media files are not fetched and unsupported types show a placeholder. Message-status notifications are acknowledged without creating leads; outbound status reconciliation comes with sending support.
- Owners/admins see their organization inbox. Team members see only conversations whose linked lead they can access. Both conversation and message tables enforce this via RLS, even through direct Supabase requests. Customers cannot write connection mappings or ingest messages.
- Inbox and history use 50-row pages and explicit refresh, not realtime subscriptions. Opening a lead refreshes workspace data first so newly received leads can open immediately.
- This is receive-only: no AI calls, provider sends, customer charges, access tokens, or outbound automation. Incoming messages do not consume the outbound-message/AI allowance. Infrastructure/storage consumption still belongs in the existing overhead allocation.

## Next integration work

Build Meta Embedded Signup and verified asset ownership, encrypted token storage, the outbound queue and usage reservations, delivery-status reconciliation, opt-in/template rules, property knowledge and AI replies, and human handover. Pro Plus scheduling remains a separate entitlement-dependent integration. Existing plan ceilings remain 70% cost / 30% gross margin.

References: [Meta webhook verification](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/) (archived SDK documentation; implementation uses Node crypto directly), [Meta webhook payload reference](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference).
