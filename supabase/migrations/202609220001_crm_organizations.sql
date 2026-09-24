-- Customer isolation foundation. Review and test on staging before production.
-- Initial model: one organisation per authenticated user; no workspace switching yet.
begin;

create table public.crm_organizations (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 1 and 150),
 created_at timestamptz not null default now()
);
-- Stable internal organisation keeps historical data and public website enquiries together.
insert into public.crm_organizations(id,name)
 values ('00000000-0000-4000-8000-000000000001','Veyrn Labs');
alter table public.crm_organizations enable row level security;
revoke all on public.crm_organizations from public,anon,authenticated;
grant select on public.crm_organizations to authenticated;
grant all on public.crm_organizations to service_role;

alter table public.crm_members add column organization_id uuid;
create function public.crm_organization_id() returns uuid
language sql stable security definer set search_path='' as $$
 select organization_id from public.crm_members where id=(select auth.uid())
$$;
revoke all on function public.crm_organization_id() from public,anon;
grant execute on function public.crm_organization_id() to authenticated,service_role;

-- Backfilling tenant keys is not a customer lead edit; preserve activity history exactly.
alter table public.crm_leads disable trigger crm_lead_after;
do $$
declare tbl text;
begin
 foreach tbl in array array['crm_members','crm_stages','crm_clients','crm_leads','crm_tasks','crm_activities','crm_saved_views'] loop
  if tbl <> 'crm_members' then
   execute format('alter table public.%I add column organization_id uuid',tbl);
  end if;
  execute format('update public.%I set organization_id=%L::uuid',tbl,'00000000-0000-4000-8000-000000000001');
  execute format('alter table public.%I alter column organization_id set not null, alter column organization_id set default public.crm_organization_id()',tbl);
  execute format('alter table public.%I add constraint %I foreign key(organization_id) references public.crm_organizations(id)',tbl,tbl||'_organization_fk');
  execute format('alter table public.%I add constraint %I unique(organization_id,id)',tbl,tbl||'_organization_id_key');
  -- Restrictive policy is ANDed with every existing role/ownership policy.
  execute format('create policy organization_isolation on public.%I as restrictive for all to authenticated using(organization_id=(select public.crm_organization_id())) with check(organization_id=(select public.crm_organization_id()))',tbl);
 end loop;
end $$;
alter table public.crm_leads enable trigger crm_lead_after;
create policy organization_read on public.crm_organizations for select to authenticated
 using(id=(select public.crm_organization_id()));

-- Tenant columns cannot be changed by ordinary users, even on tables with table-wide grants.
revoke insert,delete on public.crm_saved_views from authenticated;
grant insert(member_id,name,search,source,owner),delete on public.crm_saved_views to authenticated;

-- Composite foreign keys enforce isolation even for privileged writes and RPCs.
alter table public.crm_clients add constraint crm_clients_owner_org_fk
 foreign key(organization_id,owner_id) references public.crm_members(organization_id,id);
alter table public.crm_leads add constraint crm_leads_owner_org_fk
 foreign key(organization_id,owner_id) references public.crm_members(organization_id,id);
alter table public.crm_leads add constraint crm_leads_stage_org_fk
 foreign key(organization_id,stage_id) references public.crm_stages(organization_id,id);
alter table public.crm_leads add constraint crm_leads_client_org_fk
 foreign key(organization_id,client_id) references public.crm_clients(organization_id,id);
alter table public.crm_tasks add constraint crm_tasks_lead_org_fk
 foreign key(organization_id,lead_id) references public.crm_leads(organization_id,id);
alter table public.crm_activities add constraint crm_activities_lead_org_fk
 foreign key(organization_id,lead_id) references public.crm_leads(organization_id,id);
alter table public.crm_saved_views add constraint crm_saved_views_member_org_fk
 foreign key(organization_id,member_id) references public.crm_members(organization_id,id) on delete cascade;

alter table public.crm_stages drop constraint crm_stages_name_key;
alter table public.crm_stages add constraint crm_stages_org_name_key unique(organization_id,name);
drop index public.crm_terminal_stages;
create unique index crm_terminal_stages on public.crm_stages(organization_id,kind) where kind <> 'open';
drop index public.crm_client_email;
create unique index crm_client_email on public.crm_clients(organization_id,lower(email)) where email <> '';
alter table public.crm_leads drop constraint crm_leads_submission_id_key;
alter table public.crm_leads add constraint crm_leads_org_submission_key unique(organization_id,submission_id);

create or replace function public.crm_lead_access(lead uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.crm_leads where id=lead
  and organization_id=public.crm_organization_id() and public.crm_access(owner_id))
$$;

create or replace function public.crm_log_lead() returns trigger
language plpgsql security definer set search_path='' as $$
declare message text; activity_kind text;
begin
 if tg_op='INSERT' then message:='Lead created'; activity_kind:='created';
 elsif new.client_id is distinct from old.client_id then message:='Converted to client'; activity_kind:='converted';
 elsif new.stage_id is distinct from old.stage_id then
  select 'Moved to '||name into message from public.crm_stages where id=new.stage_id and organization_id=new.organization_id;
  activity_kind:='stage';
 else message:='Lead details updated'; activity_kind:='updated'; end if;
 insert into public.crm_activities(organization_id,lead_id,body,kind)
 values(new.organization_id,new.id,message,activity_kind);
 return new;
end $$;

create or replace function public.crm_convert_lead(lead uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare item public.crm_leads; client uuid; won uuid;
begin
 select * into item from public.crm_leads
  where id=lead and organization_id=public.crm_organization_id() for update;
 if not found or not public.crm_access(item.owner_id) then raise exception 'Lead unavailable'; end if;
 if item.client_id is not null then return item.client_id; end if;
 perform pg_advisory_xact_lock(hashtextextended(item.organization_id::text||':'||lower(item.email),0));
 select id into client from public.crm_clients
  where organization_id=item.organization_id and lower(email)=lower(item.email) and email<>'';
 if client is not null and not exists(select 1 from public.crm_clients where id=client and organization_id=item.organization_id and public.crm_access(owner_id)) then
  raise exception 'An existing client matches this email. Ask an administrator to link this lead.';
 end if;
 if client is null then
  insert into public.crm_clients(organization_id,name,company,email,phone,owner_id)
   values(item.organization_id,item.name,item.company,item.email,item.phone,item.owner_id) returning id into client;
 end if;
 select id into won from public.crm_stages where organization_id=item.organization_id and kind='won';
 if won is null then raise exception 'Workspace stages are incomplete'; end if;
 update public.crm_leads set client_id=client,stage_id=won where id=lead and organization_id=item.organization_id;
 return client;
end $$;

-- This legacy server-only RPC always captures Veyrn website enquiries into the internal org.
-- It is deliberately not a customer ingestion endpoint and accepts no caller-selected tenant.
create or replace function public.crm_capture_lead(submission uuid,contact_name text,contact_email text,contact_company text,contact_service text,contact_notes text)
returns boolean language plpgsql security definer set search_path='' as $$
declare first_stage uuid; internal_org constant uuid := '00000000-0000-4000-8000-000000000001';
begin
 perform pg_advisory_xact_lock(84921401);
 perform pg_advisory_xact_lock(hashtextextended(lower(contact_email),1));
 if exists(select 1 from public.crm_leads where organization_id=internal_org and submission_id=submission) then return false; end if;
 if (select count(*) from public.crm_leads where organization_id=internal_org and source='Website' and created_at>now()-interval '1 hour') >= 100 then raise exception 'Enquiry capacity reached. Please try again later.'; end if;
 if (select count(*) from public.crm_leads where organization_id=internal_org and lower(email)=lower(contact_email) and source='Website' and created_at>now()-interval '1 hour') >= 3 then raise exception 'Too many enquiries. Please try again later.'; end if;
 select id into first_stage from public.crm_stages where organization_id=internal_org and kind='open' order by position,id limit 1;
 if first_stage is null then raise exception 'Workspace stages are incomplete'; end if;
 insert into public.crm_leads(organization_id,name,email,company,service,notes,source,stage_id,submission_id)
 values(internal_org,contact_name,lower(contact_email),contact_company,contact_service,contact_notes,'Website',first_stage,submission);
 return true;
end $$;

-- Provisioning is available only to a trusted server; no public signup is enabled here.
create function public.crm_provision_organization(owner_user uuid,organization_name text,owner_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 if owner_user is null or nullif(trim(organization_name),'') is null or nullif(trim(owner_name),'') is null then
  raise exception 'Owner and organisation details are required';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_user::text,2));
 select organization_id into org from public.crm_members where id=owner_user;
 if org is not null then return org; end if;
 insert into public.crm_organizations(name) values(trim(organization_name)) returning id into org;
 insert into public.crm_members(id,organization_id,name,role) values(owner_user,org,trim(owner_name),'owner');
 insert into public.crm_stages(organization_id,name,position,kind) values
  (org,'New enquiry',0,'open'),(org,'Contacted',1,'open'),(org,'Qualified',2,'open'),
  (org,'Site visit scheduled',3,'open'),(org,'Negotiation',4,'open'),(org,'Won',5,'won'),(org,'Lost',6,'lost');
 return org;
end $$;
revoke all on function public.crm_provision_organization(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_provision_organization(uuid,text,text) to service_role;
commit;
