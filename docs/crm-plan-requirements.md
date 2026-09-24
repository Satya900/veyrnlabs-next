# CRM plan requirements

User-confirmed requirements, updated 2026-09-24. See `crm-launch-hardening.md` for implementation and activation status.

| Rule               | Pro                                               | Pro Plus                                          |
| ------------------ | ------------------------------------------------- | ------------------------------------------------- |
| Base monthly price | INR 4,000                                         | INR 6,000                                         |
| Included users     | 1: the company's main admin                       | 3 total: the main admin plus 2 invited users      |
| Additional users   | INR 500 per additional user beyond the included 1 | INR 500 per additional user beyond the included 3 |
| Scheduling         | Manual scheduling                                 | Automatic scheduling                              |

The main admin counts toward the included user allowance. The two additional included Pro Plus seats are part of the plan, not a temporary promotion. Both plans allow additional paid users beyond their included allowance.

Previously agreed base-plan billing: monthly at standard price, quarterly prepaid with 10% discount, annually prepaid with 20% discount.

## Pending details; do not infer billing policy

- Confirmed 2026-09-24: INR 500 per additional user per month, with no quarterly/annual seat discount. Seats use separate monthly Razorpay subscriptions; the owner approves checkout before access increases.
- Proration, when a seat becomes billable (invitation or acceptance), and how removal affects billing.
- Exact behaviour of manual versus automatic scheduling, and any other plan feature differences.

## Usage and margin requirements

- The latest approved split is **70% maximum total service cost / 30% minimum gross margin**, replacing 65/35.
- Apply the ceiling to subscription revenue excluding tax, after billing-duration discounts. It covers AI, messaging, infrastructure, payment fees, support, and maintenance together.
- No unlimited AI or messaging. Allowances are per company, shared across users; extra seats do not increase them.
- Reserve overhead before allowing variable AI/WhatsApp costs. Warn at 80% of the customer allowance; pause the affected service at its limit. No automatic overage charges.
- Exact allowances, provider rates and overhead allocations still need cost measurement. Never activate with invented production allowances.
- The margin is a ceiling target, not a guarantee against inaccurate provider estimates or unaccounted costs.

The first implementation is documented in `docs/crm-usage-rollout.md`. An invitation never purchases a seat. Seats activate only for a verified paid period. Removing a member does not cancel a subscription; owners can cancel seat renewal in Settings.
