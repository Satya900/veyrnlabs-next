begin;
create table public.crm_reconciliations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.crm_organizations(id),
 usage_event_id uuid not null references public.crm_usage_events(id), evidence text not null check(length(evidence) between 10 and 1000),
 cost_paise bigint not null check(cost_paise>=0), cancelled boolean not null, created_at timestamptz not null default now()
);
alter table public.crm_reconciliations enable row level security;
revoke all on public.crm_reconciliations from public,anon,authenticated;
grant all on public.crm_reconciliations to service_role;
create function public.crm_reconcile_usage(org uuid, event uuid, cost bigint, cancelled boolean, evidence text) returns void language plpgsql security definer set search_path='' as $$
begin
 if evidence is null or length(trim(evidence)) not between 10 and 1000 then raise exception 'Record provider evidence before reconciling'; end if;
 perform public.crm_finish_usage(org,event,cost,cancelled);
 insert into public.crm_reconciliations(organization_id,usage_event_id,evidence,cost_paise,cancelled) values(org,event,evidence,cost,cancelled);
end $$;
revoke all on function public.crm_reconcile_usage(uuid,uuid,bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.crm_reconcile_usage(uuid,uuid,bigint,boolean,text) to service_role;
commit;
