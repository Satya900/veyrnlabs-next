-- Apply once to a dedicated Supabase project using the SQL editor or CLI.
begin;
create table public.crm_members (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check (length(name) between 1 and 100),
 role text not null check (role in ('owner','admin','team'))
);
create table public.crm_stages (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(name) between 1 and 60),
 position integer not null, kind text not null default 'open' check(kind in ('open','won','lost'))
);
create unique index crm_terminal_stages on public.crm_stages(kind) where kind <> 'open';
insert into public.crm_stages(name,position,kind) values
 ('New',0,'open'),('Contacted',1,'open'),('Discovery scheduled',2,'open'),('Qualified',3,'open'),
 ('Proposal sent',4,'open'),('Negotiation',5,'open'),('Won',6,'won'),('Lost',7,'lost');
create table public.crm_clients (
 id uuid primary key default gen_random_uuid(), name text not null, company text not null default '',
 email text not null default '', phone text not null default '', owner_id uuid references public.crm_members(id),
 created_at timestamptz not null default now()
);
create unique index crm_client_email on public.crm_clients(lower(email)) where email <> '';
create table public.crm_leads (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 200),
 company text not null default '' check(length(company)<=200), email text not null default '' check(length(email)<=200),
 phone text not null default '' check(length(phone)<=200), service text not null default '' check(length(service)<=200),
 value numeric(15,2) not null default 0 check(value between 0 and 1000000000000),
 source text not null default 'Manual' check(length(source)<=200),
 stage_id uuid not null references public.crm_stages(id), owner_id uuid references public.crm_members(id),
 notes text not null default '' check(length(notes)<=5000), follow_up timestamptz,
 created_at timestamptz not null default now(), closed_at timestamptz,
 client_id uuid references public.crm_clients(id), submission_id uuid unique
);
create index crm_leads_owner on public.crm_leads(owner_id);
create index crm_leads_stage on public.crm_leads(stage_id);
create index crm_leads_followup on public.crm_leads(follow_up);
create table public.crm_tasks (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.crm_leads(id),
 title text not null check(length(title) between 1 and 300), due_at timestamptz not null,
 completed boolean not null default false, created_at timestamptz not null default now()
);
create index crm_tasks_lead on public.crm_tasks(lead_id);
create table public.crm_activities (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.crm_leads(id),
 body text not null check(length(body) between 1 and 5000), kind text not null default 'note' check(kind in ('note','call','meeting','created','stage','converted','updated','task')),
 created_at timestamptz not null default now()
);
create index crm_activities_lead on public.crm_activities(lead_id);

create function public.crm_role() returns text language sql stable security definer set search_path = '' as $$
 select role from public.crm_members where id = (select auth.uid())
$$;
create function public.crm_access(assigned uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce(public.crm_role() in ('owner','admin') or (public.crm_role()='team' and assigned=auth.uid()),false)
$$;
create function public.crm_lead_access(lead uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.crm_leads where id=lead and public.crm_access(owner_id))
$$;

alter table public.crm_members enable row level security;
alter table public.crm_stages enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_clients enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.crm_activities enable row level security;
revoke all on public.crm_members,public.crm_stages,public.crm_leads,public.crm_clients,public.crm_tasks,public.crm_activities from anon,authenticated;
grant select on public.crm_members,public.crm_stages,public.crm_leads,public.crm_clients,public.crm_tasks,public.crm_activities to authenticated;
grant insert(name,company,email,phone,service,value,source,stage_id,owner_id,notes,follow_up) on public.crm_leads to authenticated;
grant update(name,company,email,phone,service,value,source,stage_id,owner_id,notes,follow_up) on public.crm_leads to authenticated;
grant insert(lead_id,title,due_at),update(completed) on public.crm_tasks to authenticated;
grant insert(lead_id,body,kind) on public.crm_activities to authenticated;
grant insert(name,position,kind),update(name,position) on public.crm_stages to authenticated;
grant all on public.crm_members,public.crm_stages,public.crm_leads,public.crm_clients,public.crm_tasks,public.crm_activities to service_role;
create policy member_directory on public.crm_members for select to authenticated using(public.crm_role() is not null);
create policy stages_read on public.crm_stages for select to authenticated using(public.crm_role() is not null);
create policy stages_insert on public.crm_stages for insert to authenticated with check(public.crm_role() in ('owner','admin') and kind='open');
create policy stages_update on public.crm_stages for update to authenticated using(public.crm_role() in ('owner','admin')) with check(public.crm_role() in ('owner','admin'));
create policy leads_read on public.crm_leads for select to authenticated using(public.crm_access(owner_id));
create policy leads_insert on public.crm_leads for insert to authenticated with check(public.crm_access(owner_id));
create policy leads_update on public.crm_leads for update to authenticated using(public.crm_access(owner_id)) with check(public.crm_access(owner_id));
create policy clients_read on public.crm_clients for select to authenticated using(public.crm_access(owner_id) or exists(select 1 from public.crm_leads l where l.client_id=crm_clients.id and public.crm_access(l.owner_id)));
create policy tasks_read on public.crm_tasks for select to authenticated using(public.crm_lead_access(lead_id));
create policy tasks_insert on public.crm_tasks for insert to authenticated with check(public.crm_lead_access(lead_id));
create policy tasks_update on public.crm_tasks for update to authenticated using(public.crm_lead_access(lead_id)) with check(public.crm_lead_access(lead_id));
create policy activity_read on public.crm_activities for select to authenticated using(public.crm_lead_access(lead_id));
create policy activity_insert on public.crm_activities for insert to authenticated with check(public.crm_lead_access(lead_id) and kind in ('note','call','meeting'));

create function public.crm_track_lead() returns trigger language plpgsql security definer set search_path='' as $$
declare stage_kind text; stage_name text;
begin
 select kind,name into stage_kind,stage_name from public.crm_stages where id=new.stage_id;
 if tg_op='UPDATE' and old.client_id is not null and stage_kind <> 'won' then raise exception 'Converted leads must remain won. Create a new lead for repeat business.'; end if;
 if tg_op='INSERT' or new.stage_id is distinct from old.stage_id then
  new.closed_at := case when stage_kind='open' then null else now() end;
 end if;
 return new;
end $$;
create trigger crm_lead_before before insert or update on public.crm_leads for each row execute function public.crm_track_lead();
create function public.crm_log_lead() returns trigger language plpgsql security definer set search_path='' as $$
declare message text; activity_kind text;
begin
 if tg_op='INSERT' then message:='Lead created'; activity_kind:='created';
 elsif new.client_id is distinct from old.client_id then message:='Converted to client'; activity_kind:='converted';
 elsif new.stage_id is distinct from old.stage_id then select 'Moved to '||name into message from public.crm_stages where id=new.stage_id; activity_kind:='stage';
 else message:='Lead details updated'; activity_kind:='updated'; end if;
 insert into public.crm_activities(lead_id,body,kind) values(new.id,message,activity_kind);
 return new;
end $$;
create trigger crm_lead_after after insert or update on public.crm_leads for each row execute function public.crm_log_lead();

create function public.crm_convert_lead(lead uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare item public.crm_leads; client uuid; won uuid;
begin
 select * into item from public.crm_leads where id=lead for update;
 if not found or not public.crm_access(item.owner_id) then raise exception 'Lead unavailable'; end if;
 if item.client_id is not null then return item.client_id; end if;
 -- Serialize matching contacts; preserve an existing client's identity and ownership.
 perform pg_advisory_xact_lock(hashtextextended(lower(nullif(item.email,'')),0));
 select id into client from public.crm_clients where lower(email)=lower(item.email) and email<>'';
 if client is not null and not exists(select 1 from public.crm_clients where id=client and public.crm_access(owner_id)) then raise exception 'An existing client matches this email. Ask an administrator to link this lead.'; end if;
 if client is null then
  insert into public.crm_clients(name,company,email,phone,owner_id) values(item.name,item.company,item.email,item.phone,item.owner_id) returning id into client;
 end if;
 select id into won from public.crm_stages where kind='won';
 update public.crm_leads set client_id=client,stage_id=won where id=lead;
 return client;
end $$;

-- Public submissions only through the server. Email throttling survives restarts.
create function public.crm_capture_lead(submission uuid, contact_name text, contact_email text, contact_company text, contact_service text, contact_notes text) returns void language plpgsql security definer set search_path='' as $$
declare first_stage uuid;
begin
 perform pg_advisory_xact_lock(84921401);
 perform pg_advisory_xact_lock(hashtextextended(lower(contact_email),1));
 if exists(select 1 from public.crm_leads where submission_id=submission) then return; end if;
 if (select count(*) from public.crm_leads where source='Website' and created_at>now()-interval '1 hour') >= 100 then raise exception 'Enquiry capacity reached. Please try again later.'; end if;
 if (select count(*) from public.crm_leads where lower(email)=lower(contact_email) and source='Website' and created_at>now()-interval '1 hour') >= 3 then raise exception 'Too many enquiries. Please try again later.'; end if;
 select id into first_stage from public.crm_stages where kind='open' order by position limit 1;
 insert into public.crm_leads(name,email,company,service,notes,source,stage_id,submission_id)
 values(contact_name,lower(contact_email),contact_company,contact_service,contact_notes,'Website',first_stage,submission);
end $$;
revoke execute on function public.crm_role(),public.crm_access(uuid),public.crm_lead_access(uuid),public.crm_track_lead(),public.crm_log_lead(),public.crm_convert_lead(uuid),public.crm_capture_lead(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.crm_role(),public.crm_access(uuid),public.crm_lead_access(uuid),public.crm_convert_lead(uuid) to authenticated;
revoke execute on function public.crm_capture_lead(uuid,text,text,text,text,text) from authenticated;
grant execute on function public.crm_capture_lead(uuid,text,text,text,text,text) to service_role;
commit;
