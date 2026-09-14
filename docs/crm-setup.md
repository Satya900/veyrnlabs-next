# Veyrn Labs CRM — Phase 1

The CRM is implemented in the existing Next.js repository. The public website stays at `/`; the workspace is at `/crm`. A second deployment of the same repository can serve the CRM subdomain. This keeps the current website intact while sharing the lead capture contract and database migration.

## Review locally

Use Node 24 or later, then run:

```sh
npm install
npm run dev
```

Open `http://localhost:3000/crm/demo`. This is an explicitly labeled, in-memory sample workspace. Demo changes reset on reload and never write to Supabase. `/crm` redirects to login until an authenticated workspace member is available.

## Connect Supabase

1. Create a dedicated Supabase project for Veyrn Labs CRM.
2. Apply `supabase/migrations/202609140001_crm.sql`, then `supabase/migrations/202609150001_crm_saved_views.sql`, once each and in order, using the SQL editor or your normal migration workflow. Each migration is transactional and creates only `crm_*` objects.
3. Copy `.env.crm.example` to `.env.local` and replace the placeholders with the project's URL, anon/publishable key, and server-only service-role key. Never put the service key in a `NEXT_PUBLIC_*` variable or commit it.
4. Provision your initial account through Supabase Authentication and set its password there. Turn off public signup for this private workspace. Add the account to the workspace with the SQL below, replacing the UUID with the account's actual Auth user ID.
5. Restart Next.js and sign in at `/crm/login`.

```sql
insert into public.crm_members (id, name, role)
values ('ACTUAL-AUTH-USER-UUID', 'Your name', 'owner');
```

Provision additional Auth accounts and add corresponding `crm_members` records with `admin` or `team`. Account creation, password resets, membership removal, and role changes use the Supabase dashboard in this release; there is no self-service invitation UI yet.

Owners and admins can read/update all workspace leads and configure stages. Team members can access their assigned leads, related activities/tasks, and linked clients. The member directory is visible to members. Authenticated users without a `crm_members` record have no workspace access. Roles are stored in a protected table, never user-editable Auth metadata.

Sessions use a host-only, HTTP-only, SameSite Strict cookie, Secure in production. Each page/API access verifies the token with Supabase Auth and checks current membership. Sessions expire with the access token; sign in again after expiry. Refresh tokens are intentionally not persisted in this initial release. Open the sign-in link in a separate tab to retain an unsaved form. Role changes take effect on subsequent requests.

## Public website capture

The existing email and discovery-call options remain. When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured at build time, the website additionally renders an enquiry form. It submits to the website's own `/api/contact` route; cross-subdomain browser access is unnecessary.

The server validates and bounds the request, checks origin and a honeypot, and calls a service-only database function. The database atomically records an unassigned Website lead and creation activity, with a unique submission UUID to make retries idempotent. Repeated enquiries are limited to three per email per hour, with a workspace-wide ceiling of 100 website enquiries per hour. Owners/admins assign new website leads to team members. Review these limits for your traffic and add a challenge provider if abuse warrants it.

The form only reports success after the database saves the enquiry. No emails or external notifications are sent in Phase 1. If database setup is absent, the endpoint reports 503 rather than claiming delivery.

## Behavior and scope

- Overview, board/list pipeline, lead create/edit/search, source and owner filters.
- Global search (workspace topbar) queries leads and clients directly in Postgres, RLS-scoped, instead of only filtering what happened to already be loaded. Hidden automatically in `/crm/demo`, since there is no database to query.
- Saving an email that matches an existing lead or client shows who it is, non-blocking, with a link to open the existing lead instead.
- Multi-select in the Leads list view supports moving several open leads to a stage at once (`bulkStage`); converted leads are excluded from selection, matching the board's drag-and-drop rule.
- Follow-ups has a Calendar view (month grid) alongside the List view, combining incomplete tasks and open-lead follow-ups by local calendar day.
- Saved views (Leads toolbar) store a named search/source/owner combination per member in `crm_saved_views`, private to that member.
- Editable stage labels/order; extra open stages. Won/lost meanings are fixed. Stages are not deleted because leads/history reference them.
- Notes, call/meeting summaries, server-generated lead activity, follow-up dates, dated tasks, completion checkboxes, and in-app overdue indicators. Indicators refresh once per minute while the app is open; no background push/email jobs are enabled.
- Atomic lead-to-client conversion. Repeated conversion returns the same client. Matching nonempty client emails reuse the existing accessible client; inaccessible matches require an administrator. Converted leads remain won. Repeat business should be entered as another lead. Client records retain a snapshot of contact information at conversion.
- CSV preview/import (up to 500 rows and 2 MB), filtered lead export, client export, and full accessible-workspace JSON export. Import is a single database insert so invalid rows fail the batch. CSV imports create new leads rather than silently merging contacts. Export neutralizes spreadsheet formulas; leading formula characters are prefixed with an apostrophe.
- CSV headers: `name,company,email,phone,service,value,source,notes`. Only `name` is required. Imported leads enter the first open stage. Team imports are assigned to the current user; owner/admin imports are unassigned.
- Reporting is INR only. The selected period uses UTC dates. New leads use creation date, won/lost use closing date, win rate is won / (won + lost), and open pipeline covers all currently open deals. An empty closed cohort displays a dash. Won value is not cash received. Reports include only records visible to the current member.
- Database reads page through results to avoid Supabase's default row limit truncating totals/exports. The UI currently loads the accessible workspace; move filtering/report aggregation to the server for much larger datasets.

## Deploy

Use two deployments pointing to this repository and the same Supabase project:

| Variable               | Website deployment      | CRM deployment              |
| ---------------------- | ----------------------- | --------------------------- |
| `NEXT_PUBLIC_SITE_URL` | `https://veyrnlabs.com` | `https://crm.veyrnlabs.com` |
| `CRM_HOST`             | unset                   | `crm.veyrnlabs.com`         |
| `SITE_NOINDEX`         | false/unset             | true                        |
| `CRM_ENABLE_DEMO`      | false/unset             | false/unset                 |
| Supabase URL and keys  | Configure               | Configure                   |

Add the custom CRM domain in your hosting provider and apply its requested DNS records. The Next.js proxy rewrites `/` to `/crm` only on the exact configured CRM host. `/crm/*` and `/api/crm/*` carry noindex headers on all hosts, and the CRM layout disables indexing. Authorization is enforced by the backend and database, not by host routing or robots directives. The client portal subdomain is reserved for a later phase.

This change does not create a cloud project, apply a live migration, provision accounts, update DNS, or publish a deployment.

## Verification

```sh
npm run test:crm
npm run lint
npx tsc --noEmit
npm run build
```

The database suite runs the actual migration inside local PostgreSQL (PGlite), with minimal Supabase Auth role/UID shims. It verifies assigned-record isolation, rejected privilege escalation, non-member/anonymous access, admin configuration, conversion idempotency/history/task preservation, and website capture retries/throttling. Unit tests cover field validation, CSV edge cases/formula protection, and date-based reporting. This does not substitute for live Supabase Auth, HTTPS cookie, hosting, or network verification.

Before production, connect the project, then verify a real sign-in, account removal, public enquiry, owner assignment, team isolation, conversion, CSV import/export, and persistence after reload against that project. Configure database backups and verify a restore into a separate project before relying on it for business data. JSON/CSV downloads are portable exports, not full database/Auth backups. Do not restore into the live project as a test.

Reference: [Supabase Data API](https://supabase.com/docs/guides/api), [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
