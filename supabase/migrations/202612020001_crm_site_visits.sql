-- Site visits for every plan, with WhatsApp reminders and a feedback question.
-- * Any member who can see a lead schedules a visit (date, time, project); no calendar needed.
--   Visits booked through Google Calendar (by an agent or the AI) appear here too.
-- * With templates chosen in Settings, the customer gets a reminder at 6 PM the evening before
--   and 2 hours before, and a "how was your visit?" message about 3 hours after (moved to
--   10 AM when that falls between 9 PM and 9 AM). The customer's next reply is saved on the
--   visit as feedback and noted in the lead's history.
-- Messages go through the WhatsApp follow-up queue: same worker, usage, opt-out and seat rules.
begin;

-- Templates can now fill in visit details.
do $$
declare con text;
begin
 for con in select conname from pg_constraint
  where conrelid='public.crm_whatsapp_templates'::regclass and contype='c' and pg_get_constraintdef(oid) like '%lead_first_name%'
 loop execute format('alter table public.crm_whatsapp_templates drop constraint %I', con); end loop;
end $$;
alter table public.crm_whatsapp_templates add constraint crm_whatsapp_templates_params_check check (
 cardinality(params) <= 10
 and params <@ array['lead_first_name','lead_name','agent_name','business_name','service','follow_up_date',
  'visit_date','visit_time','project_name']::text[]);

create table public.crm_site_visits (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.crm_organizations(id),
 lead_id uuid not null,
 project_id uuid,
 starts_at timestamptz not null,
 status text not null default 'scheduled' check (status in ('scheduled','done','no_show','cancelled')),
 note text not null default '' check (length(note) <= 500),
 booking_id uuid unique references public.crm_calendar_bookings(id),
 feedback text not null default '' check (length(feedback) <= 1000),
 feedback_at timestamptz,
 created_by uuid references public.crm_members(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id, id),
 foreign key (organization_id, lead_id) references public.crm_leads(organization_id, id) on delete cascade,
 foreign key (organization_id, project_id) references public.crm_projects(organization_id, id) on delete set null (project_id)
);
create index crm_site_visits_due on public.crm_site_visits(starts_at) where status in ('scheduled','done');
create index crm_site_visits_lead on public.crm_site_visits(lead_id, starts_at desc);
alter table public.crm_site_visits enable row level security;
revoke all on public.crm_site_visits from public, anon, authenticated;
grant select on public.crm_site_visits to authenticated;
grant all on public.crm_site_visits to service_role;
create policy site_visits_visible on public.crm_site_visits for select to authenticated
 using (organization_id = public.crm_organization_id() and public.crm_lead_view(lead_id));

-- Visit messages ride the follow-up queue, one row per visit, kind and due time (a rescheduled
-- visit gets fresh reminders).
alter table public.crm_whatsapp_followup_jobs
 add column visit_id uuid references public.crm_site_visits(id) on delete cascade,
 add column visit_kind text check (visit_kind in ('day','soon','feedback')),
 add constraint crm_whatsapp_followup_jobs_visit check ((visit_id is null) = (visit_kind is null));
create unique index crm_whatsapp_followup_jobs_visit_once
 on public.crm_whatsapp_followup_jobs(visit_id, visit_kind, follow_up_at) where visit_id is not null;

alter table public.crm_whatsapp_followup_settings
 add column visit_reminder_template_id uuid,
 add column visit_feedback_template_id uuid,
 add constraint crm_followup_settings_visit_reminder foreign key (organization_id, visit_reminder_template_id)
  references public.crm_whatsapp_templates(organization_id, id),
 add constraint crm_followup_settings_visit_feedback foreign key (organization_id, visit_feedback_template_id)
  references public.crm_whatsapp_templates(organization_id, id);

-- When each message is due, in IST: 'day' at 6 PM the evening before, 'soon' 2 hours before,
-- 'feedback' 3 hours after the start, moved to 10 AM when that lands between 9 PM and 9 AM.
create function public.crm_visit_message_due(starts timestamptz, kind text) returns timestamptz
language sql immutable set search_path='' as $$
 select case kind
  when 'day' then (date_trunc('day', starts at time zone 'Asia/Kolkata') - interval '6 hours') at time zone 'Asia/Kolkata'
  when 'soon' then starts - interval '2 hours'
  when 'feedback' then case
   when extract(hour from (starts + interval '3 hours') at time zone 'Asia/Kolkata') >= 21
    then (date_trunc('day', (starts + interval '3 hours') at time zone 'Asia/Kolkata') + interval '34 hours') at time zone 'Asia/Kolkata'
   when extract(hour from (starts + interval '3 hours') at time zone 'Asia/Kolkata') < 9
    then (date_trunc('day', (starts + interval '3 hours') at time zone 'Asia/Kolkata') + interval '10 hours') at time zone 'Asia/Kolkata'
   else starts + interval '3 hours' end
 end
$$;

-- Claims the next due visit message and prepares it like a welcome: the job, the chat, the
-- usage reservation and the outbox row. Returns null when nothing is due.
create function public.crm_claim_visit_message(cost_paise bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.crm_site_visits; chosen_visit uuid; message_kind text; due timestamptz; l public.crm_leads; s public.crm_whatsapp_followup_settings;
 t public.crm_whatsapp_templates; w public.crm_whatsapp_connections; job public.crm_whatsapp_followup_jobs;
 chat public.crm_whatsapp_conversations; sending_member uuid; agent text; business text; project text; number text;
 params text[] := '{}'; value text; rendered text; i integer; reservation uuid; item public.crm_whatsapp_outbox;
begin
 select vs.id, k.kind, d.due_at into chosen_visit, message_kind, due
 from public.crm_site_visits vs
 join public.crm_whatsapp_followup_settings st on st.organization_id=vs.organization_id
 join public.crm_whatsapp_connections wc on wc.organization_id=vs.organization_id and wc.active and wc.provider='gupshup'
 cross join lateral (values ('day'),('soon'),('feedback')) k(kind)
 cross join lateral (select public.crm_visit_message_due(vs.starts_at, k.kind) due_at) d
 where vs.starts_at > now() - interval '2 days' and vs.starts_at < now() + interval '2 days'
  and d.due_at <= now()
  and case k.kind
   when 'day' then vs.status='scheduled' and st.visit_reminder_template_id is not null
    and vs.created_at < d.due_at and now() < vs.starts_at - interval '2 hours'
   when 'soon' then vs.status='scheduled' and st.visit_reminder_template_id is not null
    and vs.created_at < d.due_at and now() < vs.starts_at
   else vs.status in ('scheduled','done') and st.visit_feedback_template_id is not null
    and d.due_at > now() - interval '24 hours' end
  and exists(select 1 from public.crm_usage_periods p where p.organization_id=vs.organization_id
   and p.starts_at<=now() and p.ends_at>now() and p.trial_budget_paise is null)
  and not exists(select 1 from public.crm_whatsapp_followup_jobs j
   where j.visit_id=vs.id and j.visit_kind=k.kind and j.follow_up_at=d.due_at)
 order by d.due_at, vs.id limit 1 for update of vs skip locked;
 if not found then return null; end if;
 select * into v from public.crm_site_visits where id=chosen_visit;

 select * into l from public.crm_leads where id=v.lead_id and organization_id=v.organization_id;
 select * into s from public.crm_whatsapp_followup_settings where organization_id=v.organization_id;
 select * into t from public.crm_whatsapp_templates where organization_id=v.organization_id
  and id=case when message_kind='feedback' then s.visit_feedback_template_id else s.visit_reminder_template_id end;
 select * into w from public.crm_whatsapp_connections where organization_id=v.organization_id;
 number := public.crm_whatsapp_number(l.phone, coalesce(s.country_code,'91'));
 sending_member := coalesce(l.owner_id, (select m.id from public.crm_members m where m.organization_id=l.organization_id and m.role='owner' limit 1));
 insert into public.crm_whatsapp_followup_jobs(organization_id,lead_id,follow_up_at,template_id,visit_id,visit_kind)
 values(v.organization_id,v.lead_id,due,t.id,v.id,message_kind) returning * into job;
 select * into chat from public.crm_whatsapp_conversations c where c.connection_id=w.id and c.sender=number;
 if number is null or not public.crm_member_seat_active(sending_member)
   or (chat.id is not null and public.crm_whatsapp_opted_out(chat.id)) then
  update public.crm_whatsapp_followup_jobs set status='skipped',
   reason=case when number is null then 'No usable WhatsApp number'
    when not public.crm_member_seat_active(sending_member) then 'The assigned agent has no active seat'
    else 'Contact asked not to be messaged' end
  where id=job.id;
  return jsonb_build_object('job',job.id,'run',false,'skipped',true);
 end if;
 select name into agent from public.crm_members where id=sending_member;
 select name into business from public.crm_organizations where id=v.organization_id;
 select name into project from public.crm_projects where id=coalesce(v.project_id, l.project_id) and organization_id=v.organization_id;
 for i in 1..coalesce(cardinality(t.params),0) loop
  value := case t.params[i]
   when 'lead_first_name' then split_part(trim(l.name),' ',1)
   when 'lead_name' then trim(l.name)
   when 'agent_name' then agent
   when 'business_name' then business
   when 'service' then coalesce(nullif(trim(l.service),''),'your enquiry')
   when 'follow_up_date' then to_char(v.starts_at at time zone 'Asia/Kolkata','DD Mon')
   when 'visit_date' then to_char(v.starts_at at time zone 'Asia/Kolkata','FMDD Mon')
   when 'visit_time' then to_char(v.starts_at at time zone 'Asia/Kolkata','FMHH12:MI AM')
   when 'project_name' then coalesce(project, business, 'the project')
  end;
  params := params || coalesce(nullif(trim(value),''),'there');
 end loop;
 rendered := t.body;
 for i in 1..coalesce(cardinality(params),0) loop rendered := replace(rendered,'{{'||i||'}}',params[i]); end loop;
 if chat.id is null then
  insert into public.crm_whatsapp_conversations(organization_id,connection_id,lead_id,sender,contact_name,last_message_at)
  values(l.organization_id,w.id,l.id,number,left(trim(l.name),200),now()-interval '1 year') returning * into chat;
 end if;
 begin
  reservation := public.crm_reserve_usage(l.organization_id,'wa-visit:'||job.id::text,'whatsapp',1,cost_paise);
 exception when others then
  update public.crm_whatsapp_followup_jobs set status='needs_human',reason=left('Visit message not sent: '||sqlerrm,500) where id=job.id;
  return jsonb_build_object('job',job.id,'run',false);
 end;
 insert into public.crm_whatsapp_outbox(organization_id,conversation_id,usage_event_id,approved_by,body,origin,request_key)
 values(l.organization_id,chat.id,reservation,sending_member,left(rendered,3000),'followup','visit:'||job.id::text) returning * into item;
 update public.crm_whatsapp_followup_jobs set outbox_id=item.id where id=job.id;
 return jsonb_build_object('job',job.id,'token',job.claim_token,'run',true,'outbox',item.id,'organization',l.organization_id,
  'recipient',number,'phone',w.phone_number_id,'template',t.provider_template_id,'params',to_jsonb(params),'body',item.body);
end $$;
revoke all on function public.crm_claim_visit_message(bigint), public.crm_visit_message_due(timestamptz,text) from public, anon, authenticated;
grant execute on function public.crm_claim_visit_message(bigint), public.crm_visit_message_due(timestamptz,text) to service_role;

-- The lead's history names visit messages for what they are.
do $$
declare def text;
 old_text constant text := 'case when exists(select 1 from public.crm_leads ld where ld.id=j.lead_id and ld.welcome_at=j.follow_up_at)';
begin
 select pg_get_functiondef('public.crm_end_whatsapp_followup(uuid,uuid,text,text)'::regprocedure) into def;
 if position(old_text in def) = 0 then raise exception 'crm_end_whatsapp_followup is not the expected version'; end if;
 execute replace(def, old_text,
  'case when j.visit_kind=''feedback'' then ''Site visit feedback request sent ('' '
  || 'when j.visit_kind is not null then ''Site visit reminder sent ('' '
  || 'when exists(select 1 from public.crm_leads ld where ld.id=j.lead_id and ld.welcome_at=j.follow_up_at)');
end $$;

-- The customer's first reply after the feedback question is saved on the visit.
create function public.crm_capture_visit_feedback() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.crm_site_visits;
begin
 if coalesce(trim(new.body),'') = '' then return new; end if;
 select vs.* into v from public.crm_site_visits vs
 join public.crm_whatsapp_conversations c on c.id=new.conversation_id and c.lead_id=vs.lead_id
 join public.crm_whatsapp_followup_jobs j on j.visit_id=vs.id and j.visit_kind='feedback' and j.status='sent'
 where vs.organization_id=new.organization_id and vs.feedback='' and j.created_at<=now() and j.created_at>now()-interval '3 days'
 order by j.created_at desc limit 1 for update of vs;
 if not found then return new; end if;
 update public.crm_site_visits set feedback=left(trim(new.body),1000), feedback_at=now(), updated_at=now() where id=v.id;
 insert into public.crm_activities(organization_id,lead_id,kind,body)
 values(v.organization_id,v.lead_id,'note','Site visit feedback: '||left(trim(new.body),1000));
 return new;
end $$;
create trigger crm_visit_feedback after insert on public.crm_whatsapp_messages
 for each row execute function public.crm_capture_visit_feedback();

-- Visits booked through Google Calendar (by an agent or the AI) become site visits too.
create function public.crm_sync_calendar_visit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='booked' then
  insert into public.crm_site_visits(organization_id,lead_id,project_id,starts_at,booking_id,created_by)
  values(new.organization_id,new.lead_id,(select project_id from public.crm_leads where id=new.lead_id),new.starts_at,new.id,new.member_id)
  on conflict(booking_id) do update set starts_at=excluded.starts_at, updated_at=now(),
   status=case when public.crm_site_visits.status='cancelled' then 'scheduled' else public.crm_site_visits.status end;
 elsif new.status='cancelled' then
  update public.crm_site_visits set status='cancelled', updated_at=now() where booking_id=new.id and status='scheduled';
 end if;
 return new;
end $$;
create trigger crm_calendar_visit after insert or update of status on public.crm_calendar_bookings
 for each row execute function public.crm_sync_calendar_visit();
insert into public.crm_site_visits(organization_id,lead_id,project_id,starts_at,booking_id,created_by)
select b.organization_id,b.lead_id,l.project_id,b.starts_at,b.id,b.member_id
from public.crm_calendar_bookings b join public.crm_leads l on l.id=b.lead_id
where b.status='booked' on conflict(booking_id) do nothing;

-- Members schedule, reschedule and close visits on leads they can see.
create function public.crm_schedule_visit(lead uuid, starts timestamptz, project uuid, visit_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid := public.crm_member_id(); l public.crm_leads; new_id uuid; project_name text;
begin
 if me is null or not public.crm_member_seat_active(me) then raise exception 'This member needs an active paid seat'; end if;
 select * into l from public.crm_leads where id=lead and organization_id=public.crm_organization_id();
 if not found or not public.crm_lead_view(lead) then raise exception 'Lead unavailable'; end if;
 if starts is null or starts <= now() or starts > now() + interval '1 year' then raise exception 'Choose a future date and time for the visit'; end if;
 if length(coalesce(visit_note,'')) > 500 then raise exception 'Keep the note under 500 characters'; end if;
 select name into project_name from public.crm_projects where id=project and organization_id=l.organization_id;
 if project is not null and project_name is null then raise exception 'Project unavailable'; end if;
 insert into public.crm_site_visits(organization_id,lead_id,project_id,starts_at,note,created_by)
 values(l.organization_id,l.id,project,starts,coalesce(trim(visit_note),''),me) returning id into new_id;
 insert into public.crm_activities(organization_id,lead_id,kind,body)
 values(l.organization_id,l.id,'meeting','Site visit scheduled for '||to_char(starts at time zone 'Asia/Kolkata','FMDD Mon, FMHH12:MI AM')||' IST'
  ||coalesce(' at '||project_name,'')||'.');
 return new_id;
end $$;

create function public.crm_update_visit(visit uuid, new_status text, new_starts timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare me uuid := public.crm_member_id(); v public.crm_site_visits; message text;
begin
 if me is null or not public.crm_member_seat_active(me) then raise exception 'This member needs an active paid seat'; end if;
 select * into v from public.crm_site_visits where id=visit and organization_id=public.crm_organization_id() for update;
 if not found or not public.crm_lead_view(v.lead_id) then raise exception 'Visit unavailable'; end if;
 if new_status not in ('scheduled','done','no_show','cancelled') then raise exception 'Invalid status'; end if;
 if v.booking_id is not null and (new_status='cancelled' or new_starts is not null) then
  raise exception 'This visit is in Google Calendar: change or cancel it there from the lead''s calendar booking';
 end if;
 if new_starts is not null then
  if new_status<>'scheduled' or new_starts <= now() or new_starts > now() + interval '1 year' then raise exception 'Choose a future date and time for the visit'; end if;
  update public.crm_site_visits set starts_at=new_starts, status='scheduled', updated_at=now() where id=v.id;
  message := 'Site visit moved to '||to_char(new_starts at time zone 'Asia/Kolkata','FMDD Mon, FMHH12:MI AM')||' IST.';
 else
  if new_status=v.status then return; end if;
  update public.crm_site_visits set status=new_status, updated_at=now() where id=v.id;
  message := case new_status when 'done' then 'Site visit done.' when 'no_show' then 'Customer didn''t come for the site visit.'
   when 'cancelled' then 'Site visit cancelled.' else 'Site visit scheduled again.' end;
 end if;
 insert into public.crm_activities(organization_id,lead_id,kind,body) values(v.organization_id,v.lead_id,'meeting',message);
end $$;
revoke all on function public.crm_schedule_visit(uuid,timestamptz,uuid,text), public.crm_update_visit(uuid,text,timestamptz),
 public.crm_capture_visit_feedback(), public.crm_sync_calendar_visit() from public, anon, authenticated;
grant execute on function public.crm_schedule_visit(uuid,timestamptz,uuid,text), public.crm_update_visit(uuid,text,timestamptz) to authenticated;

commit;
