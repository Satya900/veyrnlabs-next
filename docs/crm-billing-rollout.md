# CRM billing rollout

Current behavior is described in [crm-launch-hardening.md](./crm-launch-hardening.md). Apply migration 012 after the original billing migration 007 and the preceding migrations in the documented order.

Price card from 28 October 2026 (migration `202610280001_crm_price_card.sql`), GST extra:

| Plan | Monthly | Quarterly total | Annual total |
| --- | ---: | ---: | ---: |
| Pro | INR 499 | INR 1,347 (449/mo) | INR 4,788 (399/mo) |
| Pro Plus | INR 699 | INR 1,887 (629/mo) | INR 6,708 (559/mo) |

Prices are an explicit table in `src/lib/crm/plans.ts` and `crm_plan_monthly_paise`; keep the two in sync (`tests/crm-pricing.test.mjs` checks this). Each base Razorpay Plan uses period `monthly`, interval 1/3/12, and the full per-cycle total above in paise. The checkout validates the actual provider Plan before creating a subscription. Set all six `RAZORPAY_PLAN_*` IDs and measured overhead/AI/WhatsApp allowances for both plans.

Each subscription stores the amount it was sold at (`crm_billing_subscriptions.amount_paise`, `crm_seat_subscriptions.unit_paise`), so subscriptions created under the earlier INR 4,000/6,000 card and INR 500 seats keep renewing at their original price. Moving them to the new card is a cancel-and-resubscribe decision, not automatic.

`CRM_OVERHEAD_*_PAISE` must be below 70% of the lowest monthly price for that plan: under 27,930 paise for Pro (70% of INR 399) and under 39,130 for Pro Plus (70% of INR 559). Checkout refuses a plan whose overhead is too high, because the payment webhook would otherwise reject the paid cycle.

Additional users cost INR 199/user/month with no duration discount (INR 500 before 28 October 2026). Create a separate monthly Plan for 19900 paise and set `RAZORPAY_PLAN_EXTRA_SEAT`. Checkout quantity is seats purchased. Seats have independent monthly renewals and never add AI/message allowance. Invitations do not charge automatically. Owners can cancel renewals in Settings; removing a member does not cancel billing.

Payment confirmation comes only from the signed webhook with captured payment identity, amount, currency, provider Plan and cycle dates. All monthly usage periods for that paid cycle are created atomically. Duplicate payments cannot reset allowances; delayed status events cannot overwrite a newer status. Existing subscriptions from version 007 need the most recent genuine charge replayed after deploying version 012. Existing usage is retained.

The original base checkout was exercised with a real Razorpay test-mode payment on 24 September before this hardening. The new prepaid-cycle and seat paths have local mocked/PGlite coverage and still require test-mode checkout/webhook/cancellation checks. Keep production sales disabled until those checks pass. GST invoicing, refunds and assisted plan upgrades/downgrades remain business/operations work; this code does not invent those policies.
