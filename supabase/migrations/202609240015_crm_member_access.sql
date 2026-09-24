begin;
-- Actor IDs in historical records are audit data, not live membership requirements.
do $$ declare c record; begin
 for c in select conrelid::regclass as tbl,conname from pg_constraint where contype='f' and confrelid='public.crm_members'::regclass
 and conrelid in ('public.crm_invitations'::regclass,'public.crm_whatsapp_outbox'::regclass,'public.crm_auto_jobs'::regclass,'public.crm_calendar_bookings'::regclass)
 loop execute format('alter table %s drop constraint %I',c.tbl,c.conname); end loop;
end $$;
alter table public.crm_ai_settings drop constraint crm_ai_settings_auto_actor_fkey;
alter table public.crm_ai_settings add constraint crm_ai_settings_auto_actor_fkey foreign key(auto_actor) references public.crm_members(id) on delete set null;
create function public.crm_member_departure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.crm_ai_settings set auto_enabled=false,auto_actor=null,updated_at=clock_timestamp() where organization_id=old.organization_id and auto_actor=old.id;
 update public.crm_auto_jobs set status='skipped',reason='Automation owner left the workspace' where actor=old.id and status='queued';
 update public.crm_invitations set revoked_at=now() where invited_by=old.id and accepted_at is null and revoked_at is null;
 return old;
end $$;
create trigger crm_member_departure before delete on public.crm_members for each row execute function public.crm_member_departure();
alter table public.crm_members add column joined_at timestamptz not null default now();
create function public.crm_member_seat_active(member uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select m.role='owner' or not exists(select 1 from public.crm_subscriptions where organization_id=m.organization_id)
 or (select count(*) from public.crm_members peers where peers.organization_id=m.organization_id and peers.role<>'owner' and (peers.joined_at,peers.id)<=(m.joined_at,m.id))
 < (select case plan when 'pro' then 1 else 3 end from public.crm_subscriptions where organization_id=m.organization_id)+public.crm_paid_seats(m.organization_id)
 from public.crm_members m where m.id=member),false)
$$;
create or replace function public.crm_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.crm_members where id=auth.uid() and public.crm_member_seat_active(id)
$$;
revoke all on function public.crm_member_seat_active(uuid),public.crm_member_departure() from public,anon,authenticated;
grant execute on function public.crm_member_seat_active(uuid) to service_role;
alter function public.crm_start_ai_draft(uuid,uuid,text,bigint) rename to crm_start_ai_draft_before_seats;
create function public.crm_start_ai_draft(actor uuid, conversation uuid, selected_model text, maximum_cost bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.crm_member_seat_active(actor) then raise exception 'This member needs an active paid seat'; end if;
 return public.crm_start_ai_draft_before_seats(actor,conversation,selected_model,maximum_cost);
end $$;
alter function public.crm_prepare_whatsapp_reply(uuid,uuid,text,uuid,text,text,bigint) rename to crm_prepare_whatsapp_reply_before_seats;
create function public.crm_prepare_whatsapp_reply(actor uuid, draft uuid, approved_text text, scoped_org uuid, scoped_phone text, scoped_waba text, cost_paise bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.crm_member_seat_active(actor) then raise exception 'This member needs an active paid seat'; end if;
 return public.crm_prepare_whatsapp_reply_before_seats(actor,draft,approved_text,scoped_org,scoped_phone,scoped_waba,cost_paise);
end $$;
revoke all on function public.crm_start_ai_draft_before_seats(uuid,uuid,text,bigint),public.crm_prepare_whatsapp_reply_before_seats(uuid,uuid,text,uuid,text,text,bigint) from public,anon,authenticated,service_role;
revoke all on function public.crm_start_ai_draft(uuid,uuid,text,bigint),public.crm_prepare_whatsapp_reply(uuid,uuid,text,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.crm_start_ai_draft(uuid,uuid,text,bigint),public.crm_prepare_whatsapp_reply(uuid,uuid,text,uuid,text,text,bigint) to service_role;
commit;
