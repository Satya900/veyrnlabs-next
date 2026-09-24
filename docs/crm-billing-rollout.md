# CRM billing rollout

Current behavior is described in [crm-launch-hardening.md](./crm-launch-hardening.md). Apply migration 012 after the original billing migration 007 and the preceding migrations in the documented order.

| Plan | Monthly | Quarterly total | Annual total |
| --- | ---: | ---: | ---: |
| Pro | INR 4,000 | INR 10,800 | INR 38,400 |
| Pro Plus | INR 6,000 | INR 16,200 | INR 57,600 |

Each base Razorpay Plan uses period `monthly`, interval 1/3/12, and the full per-cycle total above in paise. The checkout validates the actual provider Plan before creating a subscription. Set all six `RAZORPAY_PLAN_*` IDs and measured overhead/AI/WhatsApp allowances for both plans.

Additional users cost INR 500/user/month with no duration discount, confirmed by the user on 24 September. Create a separate monthly Plan for 50000 paise and set `RAZORPAY_PLAN_EXTRA_SEAT`. Checkout quantity is seats purchased. Seats have independent monthly renewals and never add AI/message allowance. Invitations do not charge automatically. Owners can cancel renewals in Settings; removing a member does not cancel billing.

Payment confirmation comes only from the signed webhook with captured payment identity, amount, currency, provider Plan and cycle dates. All monthly usage periods for that paid cycle are created atomically. Duplicate payments cannot reset allowances; delayed status events cannot overwrite a newer status. Existing subscriptions from version 007 need the most recent genuine charge replayed after deploying version 012. Existing usage is retained.

The original base checkout was exercised with a real Razorpay test-mode payment on 24 September before this hardening. The new prepaid-cycle and seat paths have local mocked/PGlite coverage and still require test-mode checkout/webhook/cancellation checks. Keep production sales disabled until those checks pass. GST invoicing, refunds and assisted plan upgrades/downgrades remain business/operations work; this code does not invent those policies.
