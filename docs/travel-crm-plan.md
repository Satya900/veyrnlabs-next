# Veyrn Travel CRM: build plan

Status: plan for review, 13 November 2026. Nothing here is built yet. It is based on `main` at
`6fa347e` (PR #43), where typecheck and all 167 CRM tests pass.

The Travel CRM is a second industry on the same Veyrn platform. A travel agency signs up, logs in
and pays the same way a real-estate business does. The difference is what the agency works with
inside: trips, itineraries, quotes, bookings, travellers, payments and departures instead of
projects and site visits.

---

## 1. Decisions this plan makes

| # | Decision | Why |
|---|---|---|
| 1 | **One app and one Supabase database. Each business has an `industry`** (`real_estate` or `travel`), set at sign-up and fixed after that. | Login, teams, WhatsApp, AI, billing and workers are reused, not copied. One login can still belong to a real-estate business and a travel business. |
| 2 | **Travel database changes live in their own folder: `supabase/travel-migrations/`.** | This is the separation you asked for. The real-estate folder `supabase/migrations/` keeps only shared and real-estate objects. |
| 3 | **Travel tables and functions are prefixed `trv_`** (e.g. `trv_bookings`, `trv_quote_totals()`). | You can tell from the name which folder owns an object; nothing collides with `crm_*`. |
| 4 | **Plan tiers are shared and prices depend on the industry.** Travel uses the existing `pro` and `pro_plus` tiers (shown as "Travel Starter" and "Travel Pro") plus a new `business` tier later. | `pro_plus` appears in about 21 places in the SQL (AI auto-replies, booking, trials, grants). Renaming tiers would change all of them; pricing by industry changes one function and the Razorpay plan IDs. |
| 5 | **Travel code lives in its own folders:** `src/lib/travel/`, `src/app/api/travel/`, `src/components/travel/`, `tests/travel-*.test.mjs`. | The real-estate code stays untouched except at a few deliberate connection points (section 3). |
| 6 | **Travel is off until switched on** with `CRM_TRAVEL_ENABLED=true`. | Same rule as every other feature: nothing reaches customers by accident. |
| 7 | **The agency's customer payments go to the agency's own account, never Veyrn's Razorpay.** | Veyrn's Razorpay is for Veyrn's subscriptions. Collecting agency money there would make Veyrn a payment intermediary. Phase 6 uses the agency's UPI ID or payment link first, and the agency's own Razorpay keys later. |

## 2. How the two migration folders work together

```
supabase/
  migrations/                     shared + real estate (crm_*)   ← unchanged rules
  travel-migrations/              travel only (trv_*)
    202612030001_trv_foundation.sql
    202612040001_trv_library.sql
    ...
scripts/
  check-production-schema.sql         (existing, crm_* objects)
  check-production-schema-travel.sql  (new, trv_* objects)
```

Rules:
1. **Run order is by filename timestamp across both folders.** A travel migration can depend on any
   core migration with an earlier timestamp. The test helper (below) merges both folders and sorts
   by filename, which is the same order you use in the SQL editor.
2. **A travel migration only creates or changes `trv_*` objects.** It may *reference* `crm_*`
   tables (foreign keys to `crm_organizations`, `crm_leads`, `crm_clients`, `crm_members`) and
   call `crm_*` helper functions (`crm_organization_id()`, `crm_role()`, `crm_member_id()`).
3. **When the shared platform has to know about travel, the change goes in the core folder** as a
   small connection-point migration (section 3), and calls into travel with dynamic SQL
   (`execute 'select public.trv_ai_knowledge($1,$2)'`). Core never needs a `trv_*` object to exist
   in order to install, so the real-estate migrations still run on their own.
4. **Same safety rules as today:** each file is one transaction, never edit an applied migration,
   every new table has RLS limited to `organization_id = crm_organization_id()`, server-only
   functions are `security definer` with `search_path=''` and execute is revoked from
   `public, anon, authenticated`.
5. **Deploy order for each PR:** apply the core migration(s), then the travel migration(s), then
   run both schema checks (each must return no rows), then merge.

Tests:
- Existing tests read only `supabase/migrations/`, so they are unaffected.
- New `tests/travel-db.mjs` helper: load every `.sql` from both folders, sort by filename, and
  replay into PGlite with the same Supabase auth shims the CRM tests use.
- New script `"test:travel": "node --test tests/travel-*.test.mjs"`, added to CI after `test:crm`.

## 3. Connection points in the shared platform (core folder, done once in Phase 0)

| Connection point | Change | Where |
|---|---|---|
| Industry | `crm_organizations.industry text not null default 'real_estate' check (industry in ('real_estate','travel'))` | new core migration `crm_industry` |
| Sign-up | `crm_provision_organization` takes `industry`; travel businesses get travel stages: *New enquiry → Contacted → Itinerary shared → Quote sent → Negotiation → Booked (won) → Lost (lost)* | same migration + `src/lib/crm/accounts.ts`, sign-up page |
| Session and workspace | `loadWorkspace` returns `industry`; `Workspace.tsx` chooses the travel sidebar and views | `src/lib/crm/server.ts`, `Workspace.tsx`, `types.ts` |
| Pricing | `crm_plan_monthly_paise(industry, plan, months)`; checkout and the price card read the business's industry; Razorpay plan env vars per industry (`RAZORPAY_PLAN_TRAVEL_PRO_1`, …) | core migration + `plans.ts`, `razorpay.ts`, `create-razorpay-plans.mjs` |
| AI knowledge | `crm_inventory_text(org, focus)` returns `trv_ai_knowledge(org, trip)` for travel businesses (packages and library instead of projects) | core migration |
| AI instructions | `draftInstructions` split per industry; travel output has `trip_request` (destination, dates, adults, children, budget) instead of `booking_request` | `src/lib/crm/ai-provider.ts`, `auto-worker.ts` |
| Lead capture | the aliases learn travel fields: destination, travel date, nights, adults, children, pax, departure city | `src/lib/crm/lead-capture.ts` |
| WhatsApp template fields | today `crm_whatsapp_templates.params` only allows lead and follow-up fields; travel adds trip fields in its own `trv_message_templates` (see M11), so this core check stays as it is | — |
| Morning briefing | an extra section for travel: departures, payments due, unconfirmed services | `src/lib/crm/briefing.ts` |
| Marketing | `/product/travel-crm-software` + sitemap | `src/app/product/…` |

## 4. Reused as is from the real-estate CRM

| Area | What travel gets without new work |
|---|---|
| Accounts | Sign-up, login, password reset, invitations, owner, admin and team roles, ownership transfer, member removal, multiple businesses per login with a switcher |
| Leads | Pipeline with stages, owner assignment, "team sees all leads" setting, tasks, activities, notes, follow-up dates, CSV import and export, saved views, global search, bulk stage change, convert to client |
| Customers | `crm_clients` (repeat travellers and families) |
| WhatsApp | Meta Embedded Signup and Gupshup, encrypted tokens per business, inbox, manual send, file send (used for PDFs), delivery and read receipts, typing indicator, opt-in and opt-out, templates, follow-up worker |
| AI | Reply drafts, automatic replies (with 3-second burst wait, runaway guard, pause, resume, AI per contact, all-chats switch), lead insights and hot/warm/cold score, usage reservation and settling, monthly allowance, top-ups |
| Lead capture | Hosted form `/f/[token]`, website embed, webhook for Zapier, Pabbly or Make (Facebook and Google Lead Ads), phone matching for repeat enquiries, instant WhatsApp welcome |
| Billing | Razorpay subscriptions, 1/3/12 month periods, extra seats, AI top-ups, trial, grace and expiry handling, webhook replay protection |
| Admin | Platform admin page, plan grants (free pilots for travel agencies), platform overview |
| Workers | Supabase Cron and GitHub Actions backup, locked job claims, worker health, reconciliation |
| Hosting | Vercel in Mumbai (`bom1`), CRM host and `noindex` handling in `proxy.ts` |

**Not shown to travel businesses:** Projects and units, brochures and RERA fields, Google Calendar
site-visit booking (`ScheduleVisit`, `booking_request`). The tables stay; the travel sidebar
doesn't link to them.

## 5. What travel agencies need: requirements by role

| Role | Their day | What the CRM must do |
|---|---|---|
| **Owner** | Revenue, margin, cash, staff performance, unpaid suppliers | Dashboard of sales, margin and cash due; profit per booking; staff conversion; supplier payables; control over who sees costs |
| **Sales agent** | Answer enquiries fast, send itineraries and quotes, chase replies | Inbox with AI, trip details picked up automatically, itinerary from a package in minutes, quote with correct tax, PDF on WhatsApp, "quote viewed" alerts, follow-ups |
| **Operations** | Confirm hotels, cabs and activities; send vouchers; manage departures | Services per booking with supplier status, booking requests to suppliers, voucher PDFs, rooming list, traveller documents, departures board, alerts for unconfirmed services |
| **Accounts** | Customer receipts, GST invoices, supplier payments, refunds | Payment schedule per booking, receipts, invoice numbering per financial year, supplier ledger, cancellations and refunds, exports for the accountant |
| **Traveller (customer)** | Wants the plan, the price, how to pay, and everything before leaving | Mobile web page for the proposal (no login), accept and pay, vouchers and contacts, WhatsApp reminders before departure |

## 6. Modules to build

Each module lists its tables, screens and the logic that needs care. A full table list is in
section 7.

### M1. Travel workspace and setup *(Phase 0–1)*
- On sign-up the business chooses its industry, when `CRM_TRAVEL_ENABLED` is on.
- Travel sidebar: **Overview, WhatsApp, Enquiries, Quotes, Bookings, Departures, Payments,
  Library (Packages, Hotels and services, Suppliers), Customers, Reports, Settings.**
- Travel settings (`trv_settings`): legal name, GSTIN, address, logo, brand colour, default
  markup, tax mode (5% on full value or 18% on margin), TCS on/off and rate, invoice prefix,
  terms, cancellation policy, bank details or UPI ID, "team can see cost and margin" switch.

### M2. Enquiries and trip requests *(Phase 1)*
- `trv_trip_requests` (one per lead, editable): destination(s), departure city, start date,
  nights or flexible, adults, children with ages, rooms, budget, hotel category, meal plan,
  trip type (honeymoon, family, group, corporate), domestic or international.
- The AI fills it in from the WhatsApp chat (new `trip_request` output); agents can correct it.
- Lead cards show destination, dates and number of travellers. Filters by destination, month and
  domestic or international.

### M3. Library: suppliers, hotels, services, packages *(Phase 2)*
- `trv_suppliers`: name, type (hotel, transport, activity, DMC, airline, visa, insurance),
  contact, WhatsApp number, GSTIN, payment terms, bank details.
- `trv_hotels` + `trv_hotel_rates`: room types × meal plans × season date ranges, with cost per
  night, extra adult, child with bed, child without bed. Currency per rate.
- `trv_services`: activities, transfers, sightseeing, visa, insurance and other services, priced
  per person, per vehicle or per group, in a currency.
- `trv_packages` + `trv_package_days`: reusable trips (destination, nights, theme, day plan,
  inclusions, exclusions, cover and day images).
- Images reuse the public `crm-files` bucket (unguessable paths, like brochures).
- Import from CSV for hotels and rates; agencies already keep these in Excel.

### M4. Itinerary builder *(Phase 3)*
- `trv_itineraries` (per lead, many allowed) + `trv_itinerary_days` + `trv_itinerary_items`
  (each item is a hotel stay, a service or a flight entered by hand, with the day, quantity and
  room or traveller split).
- Start blank, copy from a package, or **AI draft** from the trip request using only library
  items (1 AI action, through the existing usage reservation).
- Day editor: add, remove, reorder and copy days; drag library items onto a day; hotel stays
  across several nights.
- Flights are entered by hand in v1 (airline, flight number, times, PNR). There is no GDS.

### M5. Quotes and pricing engine *(Phase 3)*
- `trv_quotes` (versions per itinerary: draft → sent → viewed → accepted / rejected / expired) +
  `trv_quote_lines` (taken from the itinerary items, which can then be edited).
- **The pricing engine is one pure module, `src/lib/travel/pricing.ts`,** used by the browser
  (live totals) and by the server (stored totals). A database function `trv_quote_totals()`
  recalculates on save so the stored numbers can't be tampered with.
  - Cost in any currency × rate of exchange entered on the quote → INR paise.
  - Markup per line (percent or fixed) or one markup on the whole quote.
  - Tax mode: **5% GST on the full value** or **18% GST on the margin only**, chosen in settings
    and overridable per quote. **TCS on overseas packages** at a rate set in settings (rates
    change, so not hard-coded).
  - Rounding to whole rupees, discounts, optional add-ons, price per adult, child and room.
  - Margin and cost are hidden from the team role when the owner turns that off.
- Tests: a table of real quotes (domestic, international, 5% and 18% modes, TCS, children,
  rounding) that must match totals worked out by hand.
- **The tax rules must be checked with a CA before launch** (see section 10).

### M6. Documents and the customer page *(Phase 4)*
- `trv_documents`: type (proposal, hotel voucher, service voucher, invoice, receipt, travel
  pack), linked to a quote or booking, storage path, share token, opened count and last opened,
  revoked.
- PDFs generated on the server with **`@react-pdf/renderer`** (new dependency, pure JavaScript,
  runs on Vercel) from the agency's branding. Stored in Storage and sent on WhatsApp through the
  existing file send.
- **Customer page `/t/[token]`** (public, `noindex`, mobile first): itinerary, price, inclusions,
  terms, PDF download, **Accept quote** and payment details. Each open is recorded, the agent is
  alerted ("Neha opened the Bali quote"), and the lead moves to "Quote sent", then "Negotiation".
- Accepting a quote locks that version and creates the booking (M7).

### M7. Bookings and operations *(Phase 5)*
- `trv_bookings`: booking number, lead, customer, accepted quote, dates, status (confirmed,
  in progress, completed, cancelled), source (quote, manual, portal import), staff in charge.
- `trv_booking_services`: each hotel, transfer, activity, flight, visa or insurance service with
  its supplier, cost, dates, **supplier status (to request → requested → confirmed → cancelled)**,
  confirmation number and supplier payment due.
- **Booking request to a supplier:** ready-made text or PDF sent to the supplier's WhatsApp, or
  copied to send another way. The confirmation number is recorded back in the CRM.
- **Vouchers:** one per confirmed service, plus a combined travel pack for the customer.
- **Departures board:** trips starting in the next 7, 15 or 30 days with warnings for unconfirmed
  services, missing documents and unpaid balances. Trips in progress today. Returns.
- Ops tasks reuse `crm_tasks` linked to the lead; the booking page shows them.

### M8. Travellers and documents *(Phase 5)*
- `trv_travellers` linked to the customer (`crm_clients`) so families are re-used on the next
  trip: name as on passport, gender, date of birth, passport number, issue and expiry dates,
  nationality, meal and seat preferences. `trv_booking_travellers` links them to a booking with a
  room assignment (for the rooming list).
- Passport, visa and ID copies go to a **new private bucket `trv-documents`** (never the public
  `crm-files` bucket), read only through short-lived signed URLs. Retention setting, deletion on
  request, privacy policy update (DPDP Act).
- Warnings: passport expiring within 6 months of return, visa not done, names not matching.

### M9. Customer payments, invoices and refunds *(Phase 6)*
- `trv_payment_schedule` (advance, balance and due dates per booking) and `trv_payments`
  (received amount, method, reference, date, recorded by).
- **Payment collection v1:** the agency's own UPI ID shown as a QR code and their payment link
  on the customer page and PDFs; staff record payments by hand. **v2:** the agency connects its
  own Razorpay keys (stored encrypted like WhatsApp tokens), payment links are created
  automatically, and its webhook marks payments as paid.
- Receipts as PDFs. **GST invoices** with numbering per financial year (`trv_invoice_counters`,
  no gaps), GSTIN, place of supply and SAC code from settings.
- **Cancellations:** cancellation charges from policy, refund amount, supplier cancellation
  charges, credit note.

### M10. Supplier payables and profit *(Phase 6)*
- `trv_supplier_payments` against booking services. Payables screen per supplier with ageing
  (due, overdue).
- Profit per booking = received − paid to suppliers − taxes; expected vs actual.
- Exports (CSV) for the accountant.

### M11. Trip messages and reminders *(Phase 7)*
- `trv_message_templates`: Meta-approved templates with travel fields (customer name,
  destination, departure date, amount due, due date, document link, agent name, agency name).
- `trv_sequences` + `trv_sequence_steps`: messages timed from the departure or return date
  (default sequences for domestic, international and group trips; the agency can edit them),
  e.g. T−15 balance due, T−7 documents checklist, T−3 vouchers and travel pack, T−1 driver and
  hotel contacts, T+1 after return feedback and Google review, T+30 next-trip offer.
- Event messages: booking confirmed, payment received, payment overdue, quote opened but no reply
  after 48 hours.
- `trv_message_jobs`: queued sends with conditions (e.g. skip the payment reminder when the
  balance is paid). **Sent through the existing outbox and worker** (locked claim, never sent
  twice, WhatsApp allowance counted).
- New internal endpoint `/api/internal/travel/messages`, called by the same cron as the
  existing workers.

### M12. Reports and owner dashboard *(Phase 6–8)*
- Enquiries by source, destination and month; conversion from enquiry to quote to booking;
  time to first quote; staff leaderboard.
- Sales, margin, collected and outstanding amounts; supplier payables.
- Upcoming departures, peak months, popular packages.

### M13. Booking import from portals *(Phase 8)*
- MakeMyTrip, Goibibo and OYO don't appear to offer open APIs to agents (to be checked with
  each one). **v1 is email import:** each agency gets a forwarding address; an inbound email
  webhook (Resend, Postmark or similar) stores the email in `trv_email_imports`; parsing rules per
  portal with AI as a fallback produce a draft booking; anything uncertain waits for review.
- Market it as "Import bookings from MakeMyTrip, Goibibo, OYO & more", not "integration".

### M14. Billing and plans for travel *(Phase 0 and 8)*
- Prices per industry with the shared tiers (Decision 4):

  | Tier | Name for travel | Proposed price per month | Seats |
  |---|---|---|---|
  | `pro` | Travel Starter | ₹799 | 1 |
  | `pro_plus` | Travel Pro | ₹1,499 | 3 |
  | `business` *(later)* | Travel Business | ₹2,999 | 8 |

- Feature gates for travel: agency branding on PDFs, AI auto-replies, trip messages and email
  import from Travel Pro; supplier ledger and profit reports from Travel Business. The prices are
  **proposals for you to confirm**.

## 7. New tables (all `trv_*`, all with `organization_id` and RLS)

| Migration | Tables / functions |
|---|---|
| `trv_foundation` | `trv_settings`, `trv_trip_requests`, `trv_ai_knowledge()` |
| `trv_library` | `trv_suppliers`, `trv_hotels`, `trv_hotel_rates`, `trv_services`, `trv_packages`, `trv_package_days` |
| `trv_itineraries` | `trv_itineraries`, `trv_itinerary_days`, `trv_itinerary_items` |
| `trv_quotes` | `trv_quotes`, `trv_quote_lines`, `trv_quote_totals()`, `trv_accept_quote()` |
| `trv_documents` | `trv_documents`, `trv_document_views`, `trv_open_document()` (public, token based) |
| `trv_bookings` | `trv_bookings`, `trv_booking_services`, `trv_travellers`, `trv_booking_travellers`, private bucket `trv-documents` |
| `trv_payments` | `trv_payment_schedule`, `trv_payments`, `trv_invoice_counters`, `trv_invoices`, `trv_cancellations`, `trv_supplier_payments` |
| `trv_messages` | `trv_message_templates`, `trv_sequences`, `trv_sequence_steps`, `trv_message_jobs`, `trv_claim_message_job()` |
| `trv_email_imports` | `trv_email_imports`, `trv_import_addresses` |

Core folder adds one migration in Phase 0: `crm_industry` (industry column, travel stages at
sign-up, `crm_plan_monthly_paise(industry, …)`, `crm_inventory_text` handing off to travel).

## 8. Phases

Each phase is a series of pull requests. Every PR: migration(s) applied first, typecheck, lint,
`test:crm`, `test:travel`, build. **Phases 0–4 are the first version agencies can pay for.**

| Phase | What ships | Result |
|---|---|---|
| **0. Foundation** | `supabase/travel-migrations/`, travel test helper and `test:travel` in CI, `CRM_TRAVEL_ENABLED`, core `crm_industry` migration, industry at sign-up, travel stages, prices per industry, travel schema check script | A travel business can be created; nothing visible to real-estate customers changes |
| **1. Travel workspace and enquiries** | Travel sidebar and views, `trv_settings`, trip requests, travel AI instructions + `trip_request` output, travel lead-capture fields, travel briefing section | Enquiries from WhatsApp and forms, AI replies about trips, travel pipeline |
| **2. Library** | Suppliers, hotels and season rates, services, packages, CSV import, images | The agency's own price list and packages are in the CRM |
| **3. Itineraries and quotes** | Itinerary builder, AI draft, pricing engine with GST/TCS/currency, quote versions | Enquiry to a correctly priced quote in minutes |
| **4. Documents and launch** | PDF proposal, customer page `/t/[token]`, view alerts, accept quote → booking, marketing page `/product/travel-crm-software`, travel pricing on Razorpay | **First paid version** |
| **5. Bookings and operations** | Booking services with supplier status, supplier requests, vouchers, travellers and private documents, departures board | Ops runs every trip from the CRM |
| **6. Money** | Payment schedules, UPI/payment link, receipts, GST invoices, cancellations and refunds, supplier payables, profit, finance reports | Owner sees cash and margin |
| **7. Trip messages** | Template library, departure sequences, payment and event messages, worker endpoint | Trips run themselves after booking |
| **8. Imports and Business tier** | Portal email import, `business` tier, full reports, the agency's own Razorpay keys | Tour operators can run their business on it |

## 9. Testing

- **Pricing engine:** table-driven unit tests (domestic, international, both GST modes, TCS,
  children, rounding, currency) and a database test that `trv_quote_totals()` gives the same
  result as the TypeScript module.
- **RLS:** for every `trv_*` table, a member of another business can't read or write; a team
  member can't see cost or margin when the owner has hidden it; anonymous users get nothing.
- **Public customer page:** only a valid, unrevoked token works; opening records a view; accept
  works once and only on the latest sent version.
- **Workers:** a message job is claimed once, skipped when its condition is already met, and
  counted against the WhatsApp allowance.
- **Real estate unaffected:** the existing 167 tests keep passing, plus a test that a real-estate
  business still gets its stages, projects-based AI knowledge and prices.

## 10. Risks and open questions

| Risk | Plan |
|---|---|
| GST and TCS rules are wrong or change | Rates and modes live in settings, not in code; a CA reviews before Phase 3 ships; "verify with your accountant" note on invoices |
| Portal APIs don't exist | Email import; precise marketing wording; ask the portals about partner programmes |
| Meta template approval for trip messages | Submit templates early in Phase 7; manual send as a fallback |
| Passport data is sensitive (DPDP Act) | Private bucket, signed URLs, retention and deletion, privacy policy update |
| Collecting agency money | Agency's own UPI/payment link first; the agency's own Razorpay keys later; never Veyrn's account |
| PDF quality and speed on Vercel | react-pdf first; cache generated files; Chromium only if needed |
| Real-estate regressions | Connection points limited to section 3; travel off by default; full CRM suite in CI |

**Decisions needed before Phase 0:**
1. Confirm one database with a separate migration folder (this plan) rather than a separate
   Supabase project.
2. Confirm the travel prices and which features each tier includes.
3. Same CRM address with an industry chosen at sign-up, or a separate address for travel
   (e.g. `travel.veyrnlabs.com`)? Either works with this design; a separate address only adds a
   hostname check.
4. Find 3–5 pilot agencies (plan grants make them free) to supply real packages, rate sheets and
   quotes for testing.
