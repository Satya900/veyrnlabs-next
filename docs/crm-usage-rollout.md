# Plan entitlements and usage foundation

Apply `supabase/migrations/202609230002_crm_usage_budgets.sql` after the organization and invitation migrations. Run `npm run test:crm`, `npx tsc --noEmit`, and `npm run lint` before rollout. The migration creates no subscriptions, activates no automation, and charges nobody.

## Implemented

- Pro / Pro Plus catalog, 1 / 3 included users, manual / automatic scheduling entitlements; marketing prices share the catalog.
- Service-only subscription provisioning and monthly usage periods. Quarterly and annual subscriptions allocate discounted revenue monthly, not the entire prepayment at once.
- Total cost ceiling at 70% of tax-exclusive discounted subscription revenue. Monthly ceilings: Pro INR 2,800 / 2,520 / 2,240; Pro Plus INR 4,200 / 3,780 / 3,360 for monthly / quarterly / annual billing.
- Internal overhead allocation plus atomic cost reservations, explicit AI reply and WhatsApp message limits, settlement and confirmed cancellation. Cost and allowance checks include pending reservations.
- Settings > Plan & usage: customer-safe summary with allowances, pending usage, seats, period end and 80% warnings. Internal margins and costs are not exposed to authenticated customers or public clients.
- Subscribed organizations cannot add members beyond included plus explicitly purchased seats. This check happens at membership creation/acceptance, not invitation creation. Existing unconfigured organizations retain their current membership behavior.

## Provisioning and provider contract

Only a trusted operator/billing service may call `crm_open_usage_period`. Supply the organization, plan (`pro` / `pro_plus`), billing months (1 / 3 / 12), a one-month period, positive overhead allocation in paise, measured AI/WhatsApp allowances, and purchased seat count. Overlaps are rejected. Do not use this function to switch plans mid-period. Create each new period at renewal after confirming payment; there is no renewal scheduler or payment webhook yet.

The configured overhead must cover hosting, storage, database, background jobs, email, payment fees and allocated support/maintenance. Reserve for expected monthly costs conservatively. Additional overhead adjustments can use the usage ledger's `overhead` kind; it represents cost above the initial allocation. Provider rates must include taxes we actually bear, currency conversion and fees. All costs are rounded UP to whole INR paise so fractional costs are never silently free.

Future provider workers MUST call `reserveUsage` before each billable action, using an organization derived from a verified server-side connection and a globally unique operation key within that organization. One AI unit is one generated reply; one WhatsApp unit is one outbound message. Count human-sent messages too when they use our paid transport. Set model token limits and a conservative upper cost bound. Denied reservations MUST stop provider calls. No live worker uses these helpers yet.

Duplicate reservation keys fail closed, including cancelled/settled keys and retries in later periods. Never dispatch again just because a worker retried. After confirmed provider usage, call `finishUsage` with actual cost. Cancel only when no billable provider action occurred. Timeouts remain reserved pending reconciliation; there is intentionally no automatic timeout release. A provider overrun is recorded even above the ceiling and stops later spending; this does not retroactively prevent the overrun. A production provider integration needs a durable job queue, provider idempotency/reconciliation, bounded requests, delivery-status handling, and alerts for overruns or stuck reservations.

## Still to build

- Meta Embedded Signup and encrypted sending credentials. Receive-only webhook ingestion, trusted operator number mapping and inbox are now implemented in `docs/crm-whatsapp-rollout.md`.
- Property knowledge, scoped AI replies, opt-in/template checks and human handover.
- Pro Plus calendar integration and automated scheduling. The current field is an entitlement, not an implemented scheduler.
- Payment integration, renewals, top-ups, refund/downgrade behavior, and extra-seat billing after cadence/proration is confirmed. Extra-seat revenue is deliberately excluded from AI budgets.
- Operational cost reconciliation and proactive usage notifications. Current warnings are displayed when admins load/refresh their usage panel.

Do not expose the service-role key or the provisioning/reservation/settlement functions through customer-controlled API inputs. No external messages are sent by this migration or UI.
