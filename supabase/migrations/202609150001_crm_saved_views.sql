-- Phase 2: saved lead-list filters, private to the member who created them.
-- Apply once, after 202609140001_crm.sql, using the SQL editor or your normal migration workflow.
begin;
create table public.crm_saved_views (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.crm_members(id) on delete cascade,
 name text not null check(length(name) between 1 and 60),
 search text not null default '' check(length(search)<=200),
 source text not null default '' check(length(source)<=200),
 owner text not null default '' check(length(owner)<=200),
 created_at timestamptz not null default now()
);
create unique index crm_saved_views_member_name on public.crm_saved_views(member_id, lower(name));
create index crm_saved_views_member on public.crm_saved_views(member_id);

alter table public.crm_saved_views enable row level security;
revoke all on public.crm_saved_views from anon,authenticated;
grant select,insert,delete on public.crm_saved_views to authenticated;
grant all on public.crm_saved_views to service_role;
create policy saved_views_own on public.crm_saved_views for all to authenticated
 using(member_id = (select auth.uid()))
 with check(member_id = (select auth.uid()));
commit;
