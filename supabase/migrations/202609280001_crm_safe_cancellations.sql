begin;
alter table public.crm_calendar_bookings add column calendar_id text;
alter table public.crm_calendar_bookings add column calendar_token_encrypted text;
alter table public.crm_calendar_bookings add column cancellation_token uuid;
-- Preserve the booking agent's existing connection for historical visits where available.
update public.crm_calendar_bookings b set calendar_id=c.calendar_id,calendar_token_encrypted=c.refresh_token_encrypted
 from public.crm_calendar_connections c where c.member_id=b.member_id and c.organization_id=b.organization_id;
alter table public.crm_calendar_bookings drop constraint crm_calendar_bookings_status_check;
alter table public.crm_calendar_bookings add constraint crm_calendar_bookings_status_check
 check(status in ('reserved','booked','unknown','rejected','cancelled','cancelling'));
create or replace function public.crm_reserve_visit(org uuid, lead uuid, agent uuid, start_iso timestamptz, end_iso timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.crm_calendar_bookings; new_id uuid:=gen_random_uuid(); c public.crm_calendar_connections;
begin
 if start_iso is null or end_iso is null or start_iso<=now() or end_iso-start_iso<interval '15 minutes' or end_iso-start_iso>interval '4 hours' then raise exception 'Choose a valid future visit'; end if;
 if not exists(select 1 from public.crm_leads where id=lead and organization_id=org and owner_id=agent) then raise exception 'Lead unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(agent::text,19));
 select * into b from public.crm_calendar_bookings where lead_id=lead and starts_at=start_iso and ends_at=end_iso;
 if found and b.status not in ('rejected','cancelled') then return jsonb_build_object('booking_id',b.id,'event_id',b.event_id,'run',false,'status',b.status); end if;
 if exists(select 1 from public.crm_calendar_bookings where member_id=agent and status not in ('rejected','cancelled') and starts_at<end_iso and ends_at>start_iso) then raise exception 'This time is already reserved. Choose another slot'; end if;
 select * into c from public.crm_calendar_connections where member_id=agent and organization_id=org;
 if not found then raise exception 'The original agent must connect a calendar'; end if;
 insert into public.crm_calendar_bookings(id,organization_id,lead_id,member_id,starts_at,ends_at,event_id,calendar_id,calendar_token_encrypted)
 values(new_id,org,lead,agent,start_iso,end_iso,replace(new_id::text,'-',''),c.calendar_id,c.refresh_token_encrypted)
 on conflict(lead_id,starts_at,ends_at) do update set status='reserved',member_id=excluded.member_id,event_id=excluded.event_id,calendar_id=excluded.calendar_id,calendar_token_encrypted=excluded.calendar_token_encrypted,cancellation_token=null returning * into b;
 return jsonb_build_object('booking_id',b.id,'event_id',b.event_id,'run',true,'status',b.status);
end $$;
-- Only server code can transition cancellation after checking the signed-in actor.
drop function public.crm_prepare_visit_cancellation(uuid);
drop function public.crm_finish_visit_cancellation(uuid);
create function public.crm_prepare_visit_cancellation(booking uuid, actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.crm_calendar_bookings;
begin
 select * into b from public.crm_calendar_bookings where id=booking for update;
 if not found or not exists(select 1 from public.crm_members m join public.crm_leads l on l.organization_id=m.organization_id
 where m.id=actor and l.id=b.lead_id and m.organization_id=b.organization_id and public.crm_member_seat_active(m.id)
 and (m.role in ('owner','admin') or l.owner_id=actor)) then raise exception 'Booking unavailable'; end if;
 if b.status='cancelled' then return jsonb_build_object('already_cancelled',true); end if;
 if b.status not in ('booked','cancelling') then raise exception 'Visit is not confirmed. Reconcile the booking before cancellation'; end if;
 if b.calendar_id is null or b.calendar_token_encrypted is null then raise exception 'Original calendar unavailable. Contact support to reconcile this visit'; end if;
 update public.crm_calendar_bookings set status='cancelling',cancellation_token=coalesce(cancellation_token,gen_random_uuid()) where id=b.id returning * into b;
 return jsonb_build_object('booking_id',b.id,'event_id',b.event_id,'calendar_id',b.calendar_id,
 'refresh_token_encrypted',b.calendar_token_encrypted,'cancellation_token',b.cancellation_token);
end $$;
create function public.crm_finish_visit_cancellation(booking uuid, actor uuid, attempt uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.crm_calendar_bookings;
begin
 select * into b from public.crm_calendar_bookings where id=booking for update;
 if not found or not exists(select 1 from public.crm_members m join public.crm_leads l on l.organization_id=m.organization_id
 where m.id=actor and l.id=b.lead_id and m.organization_id=b.organization_id and public.crm_member_seat_active(m.id)
 and (m.role in ('owner','admin') or l.owner_id=actor)) then raise exception 'Booking unavailable'; end if;
 if attempt is null or b.cancellation_token is distinct from attempt then raise exception 'Cancellation attempt changed'; end if;
 if b.status='cancelled' then return; end if;
 if b.status<>'cancelling' then raise exception 'Cancellation is not pending'; end if;
 update public.crm_calendar_bookings set status='cancelled' where id=b.id;
 update public.crm_leads set follow_up=null where id=b.lead_id and organization_id=b.organization_id and follow_up=b.starts_at;
 insert into public.crm_activities(organization_id,lead_id,kind,body) values(b.organization_id,b.lead_id,'meeting',
 'Site visit for '||to_char(b.starts_at at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')||' IST was cancelled.');
end $$;
revoke all on function public.crm_prepare_visit_cancellation(uuid,uuid),public.crm_finish_visit_cancellation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_prepare_visit_cancellation(uuid,uuid),public.crm_finish_visit_cancellation(uuid,uuid,uuid) to service_role;

create or replace function public.crm_complete_visit(booking uuid, outcome text)
returns void language plpgsql security definer set search_path='' as $$
declare b public.crm_calendar_bookings;
begin
 if outcome is null or outcome not in ('booked','unknown','rejected') then raise exception 'Invalid outcome'; end if;
 select * into b from public.crm_calendar_bookings where id=booking for update;
 if not found then raise exception 'Booking unavailable'; end if;
 if b.status in ('cancelling','cancelled') then raise exception 'Booking is being cancelled'; end if;
 if b.status='booked' then return; end if;
 update public.crm_calendar_bookings set status=outcome where id=booking;
 if outcome='booked' then
  insert into public.crm_activities(organization_id,lead_id,kind,body) values(b.organization_id,b.lead_id,'meeting','Site visit scheduled for '||to_char(b.starts_at at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')||' IST via connected calendar. Reference: '||b.event_id);
  update public.crm_leads set follow_up=b.starts_at where id=b.lead_id and organization_id=b.organization_id;
 end if;
end $$;
create or replace function public.crm_lead_visit(lead uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('booking_id',b.id,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status)
 from public.crm_calendar_bookings b
 where b.lead_id=lead and b.organization_id=public.crm_organization_id() and b.status in ('reserved','booked','cancelling','unknown')
  and exists(select 1 from public.crm_leads l where l.id=lead and l.organization_id=public.crm_organization_id() and public.crm_access(l.owner_id))
 order by b.starts_at desc limit 1
$$;
commit;
