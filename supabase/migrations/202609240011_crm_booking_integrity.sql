begin;
create table public.crm_calendar_bookings (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.crm_organizations(id),
 lead_id uuid not null references public.crm_leads(id),
 member_id uuid not null references public.crm_members(id),
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 status text not null default 'reserved' check(status in ('reserved','booked','unknown','rejected')),
 event_id text not null, created_at timestamptz not null default now(),
 unique(lead_id,starts_at,ends_at)
);
alter table public.crm_calendar_bookings enable row level security;
revoke all on public.crm_calendar_bookings from public,anon,authenticated;
grant all on public.crm_calendar_bookings to service_role;

create function public.crm_reserve_visit(org uuid, lead uuid, agent uuid, start_iso timestamptz, end_iso timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.crm_calendar_bookings; new_id uuid:=gen_random_uuid();
begin
 if start_iso is null or end_iso is null or start_iso<=now() or end_iso-start_iso<interval '15 minutes' or end_iso-start_iso>interval '4 hours' then raise exception 'Choose a valid future visit'; end if;
 if not exists(select 1 from public.crm_leads where id=lead and organization_id=org and owner_id=agent) then raise exception 'Lead unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(agent::text,19));
 select * into b from public.crm_calendar_bookings where lead_id=lead and starts_at=start_iso and ends_at=end_iso;
 if found and b.status<>'rejected' then return jsonb_build_object('booking_id',b.id,'event_id',b.event_id,'run',false,'status',b.status); end if;
 if exists(select 1 from public.crm_calendar_bookings where member_id=agent and status<>'rejected' and starts_at<end_iso and ends_at>start_iso) then raise exception 'This time is already reserved. Choose another slot'; end if;
 insert into public.crm_calendar_bookings(id,organization_id,lead_id,member_id,starts_at,ends_at,event_id)
 values(new_id,org,lead,agent,start_iso,end_iso,replace(new_id::text,'-',''))
 on conflict(lead_id,starts_at,ends_at) do update set status='reserved',member_id=excluded.member_id returning * into b;
 return jsonb_build_object('booking_id',b.id,'event_id',b.event_id,'run',true,'status',b.status);
end $$;

create function public.crm_prepare_visit(lead uuid, start_iso timestamptz, end_iso timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare connection jsonb; l public.crm_leads;
begin
 connection:=public.crm_calendar_connection_for_lead(lead);
 if not exists(select 1 from public.crm_usage_periods where organization_id=public.crm_organization_id() and starts_at<=now() and ends_at>now()) then raise exception 'An active paid usage period is required'; end if;
 select * into l from public.crm_leads where id=lead and organization_id=public.crm_organization_id();
 return connection || public.crm_reserve_visit(l.organization_id,l.id,l.owner_id,start_iso,end_iso)
  || jsonb_build_object('lead_name',l.name,'lead_company',l.company,'lead_email',l.email);
end $$;

create function public.crm_complete_visit(booking uuid, outcome text)
returns void language plpgsql security definer set search_path='' as $$
declare b public.crm_calendar_bookings;
begin
 if outcome is null or outcome not in ('booked','unknown','rejected') then raise exception 'Invalid outcome'; end if;
 select * into b from public.crm_calendar_bookings where id=booking for update;
 if not found then raise exception 'Booking unavailable'; end if;
 if b.status='booked' then return; end if;
 update public.crm_calendar_bookings set status=outcome where id=booking;
 if outcome='booked' then
  insert into public.crm_activities(organization_id,lead_id,kind,body) values(b.organization_id,b.lead_id,'meeting','Site visit scheduled for '||to_char(b.starts_at at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')||' IST via connected calendar. Reference: '||b.event_id);
  update public.crm_leads set follow_up=b.starts_at where id=b.lead_id and organization_id=b.organization_id;
 end if;
end $$;

alter table public.crm_ai_drafts add column calendar_booking_id uuid references public.crm_calendar_bookings(id);
create or replace function public.crm_prepare_auto_booking(job uuid, token uuid, start_iso timestamptz, end_iso timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.crm_auto_jobs; draft public.crm_ai_drafts; lead_row public.crm_leads; c public.crm_calendar_connections; settings public.crm_ai_settings; chat public.crm_whatsapp_conversations; reservation jsonb; latest uuid;
begin
 select * into item from public.crm_auto_jobs where id=job and claim_token=token and status='processing' for update;
 if not found then raise exception 'Job unavailable'; end if;
 select * into settings from public.crm_ai_settings where organization_id=item.organization_id;
 select * into chat from public.crm_whatsapp_conversations where id=item.conversation_id for update;
 select id into latest from public.crm_whatsapp_messages where conversation_id=chat.id order by sent_at desc,id desc limit 1;
 if chat.ai_paused or not coalesce(settings.auto_enabled,false) or not settings.drafts_enabled or settings.updated_at<>item.settings_at or settings.auto_actor is distinct from item.actor
 or latest is distinct from item.source_message_id or item.claimed_at<now()-interval '5 minutes'
 or not public.crm_member_seat_active(item.actor)
 or not exists(select 1 from public.crm_members where id=item.actor and organization_id=item.organization_id and role in ('owner','admin')) then raise exception 'Automation changed; review this request'; end if;
 select * into draft from public.crm_ai_drafts where id=item.draft_id for update;
 if not found then raise exception 'Draft unavailable'; end if;
 if draft.booking_status<>'none' then return jsonb_build_object('run',false); end if;
 if not exists(select 1 from public.crm_subscriptions where organization_id=item.organization_id and plan='pro_plus' and active)
 or not exists(select 1 from public.crm_usage_periods where organization_id=item.organization_id and starts_at<=now() and ends_at>now()) then raise exception 'Automatic scheduling requires active Pro Plus access'; end if;
 select * into lead_row from public.crm_leads where id=chat.lead_id and organization_id=item.organization_id;
 if not found or lead_row.owner_id is null then raise exception 'Assign this lead to an agent before scheduling a site visit'; end if;
 select * into c from public.crm_calendar_connections where member_id=lead_row.owner_id and organization_id=item.organization_id;
 if not found then raise exception 'The assigned agent has not connected a calendar'; end if;
 reservation:=public.crm_reserve_visit(item.organization_id,lead_row.id,lead_row.owner_id,start_iso,end_iso);
 update public.crm_ai_drafts set booking_status='attempted',calendar_booking_id=(reservation->>'booking_id')::uuid where id=draft.id;
 return reservation || jsonb_build_object('calendar_id',c.calendar_id,'refresh_token_encrypted',c.refresh_token_encrypted,'lead_name',lead_row.name,'lead_company',lead_row.company,'lead_email',lead_row.email);
end $$;

create or replace function public.crm_finish_auto_booking(job uuid, token uuid, outcome text, start_iso timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare item public.crm_auto_jobs; draft public.crm_ai_drafts;
begin
 if outcome is null or outcome not in ('booked','unavailable','failed') then raise exception 'Invalid outcome'; end if;
 select * into item from public.crm_auto_jobs where id=job and claim_token=token and status='processing' for update;
 if not found then raise exception 'Job unavailable'; end if;
 select * into draft from public.crm_ai_drafts where id=item.draft_id for update;
 if not found or draft.booking_status<>'attempted' then return; end if;
 if draft.calendar_booking_id is not null then perform public.crm_complete_visit(draft.calendar_booking_id,case outcome when 'booked' then 'booked' when 'unavailable' then 'rejected' else 'unknown' end); end if;
 update public.crm_ai_drafts set booking_status=outcome where id=draft.id;
end $$;
revoke all on function public.crm_reserve_visit(uuid,uuid,uuid,timestamptz,timestamptz),public.crm_complete_visit(uuid,text),public.crm_prepare_visit(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_reserve_visit(uuid,uuid,uuid,timestamptz,timestamptz),public.crm_complete_visit(uuid,text) to service_role;
grant execute on function public.crm_prepare_visit(uuid,timestamptz,timestamptz) to authenticated;
commit;
