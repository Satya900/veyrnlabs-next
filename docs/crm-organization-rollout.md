# Customer workspace isolation: staging rollout

## Status

Migration `202609220001_crm_organizations.sql` is implemented and tested locally. It has not been applied to hosted Supabase. Existing app queries continue to use the member's access token; database policies derive organisation from membership, not browser input. No customer signup endpoint is exposed by this change.

## Data model

- Each `crm_members` record belongs to exactly one `crm_organizations` row. This first version supports one business per auth user. Cross-business account switching and multiple memberships are intentionally not implemented.
- Existing records are assigned to the internal Veyrn Labs organisation (`00000000-0000-4000-8000-000000000001`). IDs, original ownership, and activity history are preserved.
- All seven CRM tables require an organisation ID. New authenticated records default to the current member's organisation. Anonymous/unprovisioned callers have no default organisation and no data access.
- Restrictive organisation policies are combined with existing owner/admin/team policies. An owner or admin can only administer records in their own business.
- Composite foreign keys prevent linking leads, clients, agents, stages, tasks, and activities across organisations, including privileged writes.
- Unique stage names, terminal stages, contact emails, and submission IDs are scoped to the organisation.
- The existing website capture RPC is pinned to the internal Veyrn organisation. The global notification email remains valid for these internal enquiries only. Do not reuse it for customer lead ingestion.

## Validation

Run `npm run test:crm`. The suite applies migrations in an in-memory PostgreSQL-compatible PGlite database and exercises RLS as authenticated, anonymous, and service roles. It covers historical backfill, owner/admin/agent scope, bulk updates, searches, conversion, independent same-email clients, cross-organisation foreign keys, saved views, provisioning rollback/retries, and internal enquiry capture.

Local database tests do not replace a hosted Supabase staging test: verify PostgREST/RPC access and auth behaviour with separate test accounts before production.

## Staging procedure

1. Take a database backup and record baseline row counts for all CRM tables, especially activities. Use a staging copy with the first three migrations already applied.
2. Apply the new migration as a database administrator through the normal migration workflow. It runs in a transaction and acquires table locks; allow a suitable maintenance window for large datasets. It assumes all existing records belong to Veyrn's internal workspace.
3. Verify row counts and historical IDs are unchanged. Confirm the existing internal owner and team can still use the app, search, save views, convert leads, and capture an internal website enquiry.
4. Create two separate verified test users using the normal Supabase auth administration workflow. From the trusted server with a service-role credential, call `crm_provision_organization` with each user's UUID, business name, and owner name. Never place this credential in browser code.
5. Sign in as each test owner through the existing login. Create leads, tasks, and notes; verify neither account can see or alter the other's data through the app or direct authenticated REST/RPC requests. Verify a foreign owner's/stage's UUID cannot be assigned to a lead.
6. Check a same-email conversion in both businesses creates independent clients, stage configuration is separate, and anonymous capture remains restricted to the internal workspace.
7. Review results before production rollout. No production migration was executed by the implementation task.

## Provisioning contract

`crm_provision_organization(owner_user uuid, organization_name text, owner_name text) -> uuid`

Requires a pre-existing auth user. The RPC creates the organisation, owner membership, and seven real estate stages atomically. Retries for an existing member return that member's current organisation without renaming it or creating a second business. The trusted caller must obtain the user ID from a verified account workflow; this is not an unauthenticated signup API. Provisioning does not create a subscription or grant paid entitlements.

Additional member invitations, email verification and recovery, subscription billing, quotas, and AI integrations remain separate work. Existing server-side data access must continue using the signed-in user's token; replacing it with a service-role client would bypass RLS.

## Recovery

If migration execution fails, its transaction rolls back. After a successful migration, do not remove organisation policies as a rollback strategy: that would reopen the shared workspace. Disable new customer access and restore the validated backup through the normal recovery procedure if necessary, accounting for writes since the backup.
