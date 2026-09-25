-- Site-visit cancellation/rescheduling did not exist anywhere: no Google Calendar
-- delete-event support, no cancel action in the API or UI, and rebooking a lead at a
-- new time left the old booking row and its real Google Calendar event orphaned. Add
-- cancellation as a first-class booking outcome, applying uniformly to both the manual
-- and the automatic (Pro Plus, WhatsApp-driven) booking paths since both write into the
-- same crm_calendar_bookings table. "Reschedule" is cancel-then-book-a-new-slot through
-- the existing booking flow, which this also unblocks by excluding cancelled bookings
-- from the conflict/idempotency checks the same way rejected ones already were.
begin;
alter table public.crm_calendar_bookings drop constraint crm_calendar_bookings_status_check;
alter table public.crm_calendar_bookings add constraint crm_calendar_bookings_status_check
 check(status in ('reserved','booked','unknown','rejected','cancelled'));

create or replace function public.crm_reserve_visit(org uuid, lead uuid, agent uuid, start_iso timestamptz, end_iso timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.crm_calendar_bookings; new_id uuid:=gen_random_uuid();
begin
 if start_iso is null or end_iso is null or start_iso<=now() or end_iso-start_iso<interval '15 minutes' or end_iso-start_iso>interval '4 hours' then raise exception 'Choose a valid future visit'; end if;
 if not exists(select 1 from public.crm_leads where id=lead and organization_id=org and owner_id=agent) then raise exception 'Lead unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(agent::text,19));
 select * into b from public.crm_calendar_bookings where lead_id=lead and starts_at=start_iso and ends_at=end_iso;
 if found and b.status not in ('rejected','cancelled') then return jsonb_build_object('booking_id',b.id,'event_id',b.event_id,'run',false,'status',b.status); end if;
 if exists(select 1 from public.crm_calendar_bookings where member_id=agent and status not in ('rejected','cancelled') and starts_at<end_iso and ends_at>start_iso) then raise exception 'This time is already reserved. Choose another slot'; end if;
 insert into public.crm_calendar_bookings(id,organization_id,lead_id,member_id,starts_at,ends_at,event_id)
 values(new_id,org,lead,agent,start_iso,end_iso,replace(new_id::text,'-',''))
 on conflict(lead_id,starts_at,ends_at) do update set status='reserved',member_id=excluded.member_id returning * into b;
 return jsonb_build_object('booking_id',b.id,'event_id',b.event_id,'run',true,'status',b.status);
end $$;

-- Status-only view for the lead detail panel; no token, so no entitlement re-check needed
-- beyond ordinary tenant/lead access.
create function public.crm_lead_visit(lead uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('booking_id',b.id,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status)
 from public.crm_calendar_bookings b
 where b.lead_id=lead and b.organization_id=public.crm_organization_id() and b.status in ('reserved','booked')
  and exists(select 1 from public.crm_leads l where l.id=lead and l.organization_id=public.crm_organization_id() and public.crm_access(l.owner_id))
 order by b.starts_at desc limit 1
$$;
revoke all on function public.crm_lead_visit(uuid) from public,anon;
grant execute on function public.crm_lead_visit(uuid) to authenticated;

-- Two-phase like the booking flow itself: fetch credentials and re-validate entitlement
-- before the external Google call, then record the outcome after, so a failed or
-- half-finished Google call never gets silently recorded as cancelled.
create function public.crm_prepare_visit_cancellation(booking uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.crm_calendar_bookings; connection jsonb;
begin
 select * into b from public.crm_calendar_bookings where id=booking and organization_id=public.crm_organization_id();
 if not found then raise exception 'Booking unavailable'; end if;
 if b.status not in ('reserved','booked') then raise exception 'This visit is not currently booked'; end if;
 connection:=public.crm_calendar_connection_for_lead(b.lead_id);
 return connection || jsonb_build_object('booking_id',b.id,'event_id',b.event_id,'lead_id',b.lead_id,'starts_at',b.starts_at);
end $$;

create function public.crm_finish_visit_cancellation(booking uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.crm_calendar_bookings;
begin
 select * into b from public.crm_calendar_bookings where id=booking and organization_id=public.crm_organization_id() for update;
 if not found then raise exception 'Booking unavailable'; end if;
 if b.status not in ('reserved','booked') then return; end if;
 update public.crm_calendar_bookings set status='cancelled' where id=booking;
 update public.crm_leads set follow_up=null where id=b.lead_id and organization_id=b.organization_id and follow_up=b.starts_at;
 insert into public.crm_activities(organization_id,lead_id,kind,body) values(b.organization_id,b.lead_id,'meeting',
  'Site visit for '||to_char(b.starts_at at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')||' IST was cancelled.');
end $$;
revoke all on function public.crm_prepare_visit_cancellation(uuid),public.crm_finish_visit_cancellation(uuid) from public,anon;
grant execute on function public.crm_prepare_visit_cancellation(uuid),public.crm_finish_visit_cancellation(uuid) to authenticated;
commit;
