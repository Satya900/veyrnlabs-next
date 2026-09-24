# Veyrn CRM implementation status

Updated 24 September 2026. Veyrn Labs is the company; Veyrn CRM is the real-estate-first product. The authoritative activation steps for recent work are in [crm-launch-hardening.md](./crm-launch-hardening.md).

## Implemented

- Product website and Pro/Pro Plus pricing: INR 4,000/6,000 monthly, 10% quarterly and 20% annual prepayment discounts.
- Tenant-isolated workspaces, email verification, password reset, invitations, ownership transfer and member removal.
- Leads, clients, stages, activities, tasks, follow-ups, reporting, imports, saved views and workspace export.
- WhatsApp incoming messages, reviewed sending, delivery/read receipts, AI drafts, company knowledge, human takeover and opt-in automatic replies.
- Shared AI/messaging quotas and internal cost accounting targeting at most 70% service cost, with no automatic overages.
- Razorpay base subscriptions and verified-charge activation, monthly allowance slices across prepaid durations, resumable/cancellable checkout, and separate INR 500 monthly extra-seat subscriptions without duration discounts.
- Google Calendar connections for agents, Pro Plus site-visit booking, database reservations and external-outcome reconciliation. AI can extract and book an unambiguous available slot when automatic replies are enabled.
- Embedded Signup UI/server integration, encrypted per-company WhatsApp credentials, tenant-aware sending, disconnect and expiry checks.
- Persistent-worker deployment configuration for Render calling Vercel, queue cleanup, health reporting and operator reconciliation endpoints.

## Verified versus pending

Prior rollout records report live inbound/reviewed outbound WhatsApp with read receipts, a Razorpay test payment activating one period, and a Google Calendar connection and booked event. Those checks predate the hardening changes.

Migrations 011–015 and their application changes are locally tested. They have not been applied to hosted Supabase by this task. The new seat checkout, customer Embedded Signup, production worker deployment and complete automatic-booking conversation still require external end-to-end verification. Environment flags alone are not proof of deployment or worker health.

## External launch steps

Apply the new migrations, replay existing prepaid subscriptions' latest captured-charge webhooks to fill future monthly periods, configure the extra-seat Razorpay Plan, complete Meta Tech Provider/Embedded Signup approval and configuration, verify Google's production OAuth access, and deploy the worker with the production Vercel origin. Follow the current hardening checklist before accepting public customers.

## Later product work

Property inventory and structured buyer/renter matching, configurable company time zones/business hours, external calendar cancellation/reschedule sync, proactive WhatsApp template follow-up sequences, full customer data deletion, richer billing changes, and session refresh are not part of this hardening release. Scheduling currently uses IST. A successful local suite does not establish provider reliability or actual operating margin; continue measuring real invoices and support costs.
