begin;
create table public.crm_whatsapp_credentials (
 organization_id uuid primary key references public.crm_organizations(id),
 token_encrypted text not null, expires_at timestamptz, checked_at timestamptz not null default now()
);
create table public.crm_worker_health (id text primary key, last_seen timestamptz not null default now(), last_success timestamptz, last_error text);
alter table public.crm_whatsapp_credentials enable row level security;
alter table public.crm_worker_health enable row level security;
revoke all on public.crm_whatsapp_credentials,public.crm_worker_health from public,anon,authenticated;
grant all on public.crm_whatsapp_credentials,public.crm_worker_health to service_role;

create function public.crm_save_whatsapp_connection(actor uuid, waba text, phone text, display_number text, encrypted_token text, expires timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid; old_phone text;
begin
 select organization_id into org from public.crm_members where id=actor and role='owner';
 if not found then raise exception 'Only the owner connects WhatsApp'; end if;
 if nullif(encrypted_token,'') is null or (expires is not null and expires<=now()) then raise exception 'Invalid credentials'; end if;
 perform 1 from public.crm_organizations where id=org for update;
 select phone_number_id into old_phone from public.crm_whatsapp_connections where organization_id=org;
 if old_phone is not null and old_phone<>phone then raise exception 'A different number is already linked. Contact support to migrate conversation history'; end if;
 insert into public.crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active) values(org,waba,phone,display_number,true)
 on conflict(organization_id) do update set waba_id=excluded.waba_id,display_phone=excluded.display_phone,active=true;
 insert into public.crm_whatsapp_credentials(organization_id,token_encrypted,expires_at) values(org,encrypted_token,expires)
 on conflict(organization_id) do update set token_encrypted=excluded.token_encrypted,expires_at=excluded.expires_at,checked_at=now();
end $$;

create function public.crm_disconnect_whatsapp() returns void language plpgsql security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id();
begin
 if org is null or public.crm_role()<>'owner' then raise exception 'Only the owner disconnects WhatsApp'; end if;
 update public.crm_whatsapp_connections set active=false where organization_id=org;
 delete from public.crm_whatsapp_credentials where organization_id=org;
 update public.crm_ai_settings set auto_enabled=false,updated_at=clock_timestamp() where organization_id=org;
 update public.crm_auto_jobs set status='skipped',reason='WhatsApp disconnected' where organization_id=org and status='queued';
end $$;

create function public.crm_worker_maintenance() returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.crm_worker_health(id,last_seen) values('replies',now()) on conflict(id) do update set last_seen=now();
 with stale as (update public.crm_auto_jobs set status='failed',reason='Worker interrupted; review the provider outcome before resuming' where status='processing' and claimed_at<now()-interval '5 minutes' returning conversation_id)
 update public.crm_whatsapp_conversations set ai_paused=true where id in(select conversation_id from stale);
end $$;

create function public.crm_calendar_entitlement() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('status',case when exists(select 1 from public.crm_subscriptions s join public.crm_usage_periods p using(organization_id) where s.organization_id=public.crm_organization_id() and s.active and p.starts_at<=now() and p.ends_at>now()) then 'active' else 'inactive' end,'plan',(select plan from public.crm_subscriptions where organization_id=public.crm_organization_id()))
$$;
revoke all on function public.crm_save_whatsapp_connection(uuid,text,text,text,text,timestamptz),public.crm_disconnect_whatsapp(),public.crm_worker_maintenance(),public.crm_calendar_entitlement() from public,anon,authenticated;
grant execute on function public.crm_save_whatsapp_connection(uuid,text,text,text,text,timestamptz),public.crm_worker_maintenance() to service_role;
grant execute on function public.crm_disconnect_whatsapp(),public.crm_calendar_entitlement() to authenticated;
commit;
