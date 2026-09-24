-- Pro Plus scheduler foundation: per-agent Google Calendar connection and lead-scoped access
-- to it. No calendar is connected and no event is created by this migration.
begin;
create table public.crm_calendar_connections (
 member_id uuid primary key references public.crm_members(id) on delete cascade,
 organization_id uuid not null references public.crm_organizations(id),
 provider text not null default 'google' check(provider='google'),
 calendar_id text not null default 'primary' check(length(calendar_id) between 1 and 200),
 -- Encrypted (AES-256-GCM) in the application layer before this ever reaches the database;
 -- never selectable by authenticated, and never returned to the browser once decrypted.
 refresh_token_encrypted text not null check(length(refresh_token_encrypted) between 1 and 4000),
 connected_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(organization_id,member_id) references public.crm_members(organization_id,id)
);
alter table public.crm_calendar_connections enable row level security;
revoke all on public.crm_calendar_connections from public,anon,authenticated;
grant all on public.crm_calendar_connections to service_role;

-- The agent connects their own calendar. Requires an active Pro Plus subscription; connecting
-- does not itself book anything.
create function public.crm_save_calendar_connection(new_calendar_id text, refresh_token_encrypted text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); actor uuid:=(select auth.uid());
begin
 if org is null then raise exception 'Membership unavailable'; end if;
 if not exists(select 1 from public.crm_subscriptions where organization_id=org and plan='pro_plus' and active)
 then raise exception 'Automatic scheduling requires an active Pro Plus subscription'; end if;
 if nullif(trim(new_calendar_id),'') is null or nullif(trim(refresh_token_encrypted),'') is null
 then raise exception 'Invalid calendar connection'; end if;
 insert into public.crm_calendar_connections(member_id,organization_id,calendar_id,refresh_token_encrypted)
 values(actor,org,new_calendar_id,refresh_token_encrypted)
 on conflict(member_id) do update set
  calendar_id=excluded.calendar_id,refresh_token_encrypted=excluded.refresh_token_encrypted,updated_at=now();
end $$;
revoke all on function public.crm_save_calendar_connection(text,text) from public,anon;
grant execute on function public.crm_save_calendar_connection(text,text) to authenticated;

create function public.crm_disconnect_calendar() returns void
language plpgsql security definer set search_path='' as $$
begin
 delete from public.crm_calendar_connections where member_id=(select auth.uid());
end $$;
revoke all on function public.crm_disconnect_calendar() from public,anon;
grant execute on function public.crm_disconnect_calendar() to authenticated;

-- Caller-only status; never exposes the token.
create function public.crm_calendar_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.crm_calendar_connections;
begin
 select * into c from public.crm_calendar_connections where member_id=(select auth.uid());
 if not found then return jsonb_build_object('connected',false); end if;
 return jsonb_build_object('connected',true,'connected_at',c.connected_at);
end $$;
revoke all on function public.crm_calendar_status() from public,anon;
grant execute on function public.crm_calendar_status() to authenticated;

-- Server-only bridge from a lead to its owner's calendar credentials, used exclusively by the
-- server process that calls the Google Calendar API; the token never reaches the browser.
-- Requires the caller to have access to the lead and the organization to hold an active Pro
-- Plus subscription, re-checked here rather than trusted from the client.
create function public.crm_calendar_connection_for_lead(lead uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); owner uuid; c public.crm_calendar_connections;
begin
 if org is null then raise exception 'Membership unavailable'; end if;
 if not exists(select 1 from public.crm_subscriptions where organization_id=org and plan='pro_plus' and active)
 then raise exception 'Automatic scheduling requires an active Pro Plus subscription'; end if;
 select owner_id into owner from public.crm_leads where id=lead and organization_id=org and public.crm_access(owner_id);
 if owner is null then raise exception 'Lead unavailable'; end if;
 select * into c from public.crm_calendar_connections where member_id=owner and organization_id=org;
 if not found then raise exception 'The assigned agent has not connected a calendar'; end if;
 return jsonb_build_object('member_id',c.member_id,'calendar_id',c.calendar_id,
  'refresh_token_encrypted',c.refresh_token_encrypted);
end $$;
revoke all on function public.crm_calendar_connection_for_lead(uuid) from public,anon;
grant execute on function public.crm_calendar_connection_for_lead(uuid) to authenticated;
commit;
