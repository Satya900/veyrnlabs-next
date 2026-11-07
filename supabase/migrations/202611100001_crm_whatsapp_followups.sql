-- Typed WhatsApp replies and automatic WhatsApp template follow-ups.
--
-- Both send through crm_whatsapp_outbox, so they appear in a conversation's reply history,
-- pick up delivery receipts, and settle usage through crm_finish_whatsapp_reply exactly like
-- reviewed AI replies. Neither involves AI.
begin;

-- Outbox rows no longer always come from an AI draft.
alter table public.crm_whatsapp_outbox alter column draft_id drop not null,
 add column request_key text unique check (request_key is null or length(request_key) between 1 and 120);
alter table public.crm_whatsapp_outbox drop constraint crm_whatsapp_outbox_origin_check;
alter table public.crm_whatsapp_outbox add constraint crm_whatsapp_outbox_origin_check
 check (origin in ('reviewed', 'automatic', 'manual', 'followup'));

-- A reply typed by a person. Same rules as approving an AI draft: the lead's agent or an
-- owner/admin, an active seat, the connected number, an open 24-hour window, no opt-out,
-- and a usage reservation. `request` makes a double-clicked Send idempotent.
create function public.crm_prepare_manual_reply(actor uuid, conversation uuid, reply_text text, request uuid,
 scoped_org uuid, scoped_phone text, scoped_waba text, cost_paise bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.crm_members; c public.crm_whatsapp_conversations; connection public.crm_whatsapp_connections;
 latest public.crm_whatsapp_messages; item public.crm_whatsapp_outbox; reservation uuid;
begin
 if reply_text is null or length(trim(reply_text)) not between 1 and 3000 then raise exception 'Reply must contain 1–3000 characters'; end if;
 if request is null then raise exception 'Invalid request'; end if;
 select * into m from public.crm_members where id=actor;
 if not found or not public.crm_member_seat_active(actor) then raise exception 'This member needs an active paid seat'; end if;
 select * into item from public.crm_whatsapp_outbox where request_key='manual:'||request::text;
 if found then return jsonb_build_object('id',item.id,'run',false,'status',item.status); end if;
 select * into c from public.crm_whatsapp_conversations where id=conversation and organization_id=m.organization_id for update;
 if not found or not exists(select 1 from public.crm_leads where id=c.lead_id and organization_id=m.organization_id
  and (m.role in ('owner','admin') or owner_id=actor)) then raise exception 'Conversation unavailable'; end if;
 if c.organization_id is distinct from scoped_org then raise exception 'Sending is not configured for this workspace'; end if;
 select * into connection from public.crm_whatsapp_connections where id=c.connection_id;
 if not connection.active or connection.phone_number_id is distinct from scoped_phone or connection.waba_id is distinct from scoped_waba
 then raise exception 'Sending connection unavailable'; end if;
 select * into latest from public.crm_whatsapp_messages where conversation_id=c.id order by sent_at desc,id desc limit 1;
 if latest.id is null or latest.sent_at<now()-interval '23 hours 59 minutes' then
  raise exception 'Reply window closed. WhatsApp only allows free-text replies within 24 hours of the customer''s last message';
 end if;
 if exists(select 1 from public.crm_whatsapp_messages where conversation_id=c.id and body ~* '(^|[^a-z])(stop|unsubscribe|opt out)([^a-z]|$)')
 then raise exception 'Contact requested no messages. Sending is blocked pending consent review'; end if;
 reservation := public.crm_reserve_usage(c.organization_id,'wa-manual:'||request::text,'whatsapp',1,cost_paise);
 insert into public.crm_whatsapp_outbox(organization_id,conversation_id,usage_event_id,approved_by,body,origin,request_key)
 values(c.organization_id,c.id,reservation,actor,trim(reply_text),'manual','manual:'||request::text) returning * into item;
 return jsonb_build_object('id',item.id,'run',true,'recipient',c.sender,'body',item.body,'phone',connection.phone_number_id);
end $$;
revoke all on function public.crm_prepare_manual_reply(uuid,uuid,text,uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.crm_prepare_manual_reply(uuid,uuid,text,uuid,uuid,text,text,bigint) to service_role;

-- Approved WhatsApp templates the workspace registered, and what fills each {{n}}.
create table public.crm_whatsapp_templates (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.crm_organizations(id),
 label text not null check (length(trim(label)) between 1 and 80),
 provider_template_id text not null check (provider_template_id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
 body text not null check (length(trim(body)) between 1 and 1024),
 params text[] not null default '{}' check (
  cardinality(params) <= 10
  and params <@ array['lead_first_name','lead_name','agent_name','business_name','service','follow_up_date']::text[]),
 created_at timestamptz not null default now(),
 unique (organization_id, id),
 unique (organization_id, provider_template_id)
);
create table public.crm_whatsapp_followup_settings (
 organization_id uuid primary key references public.crm_organizations(id),
 enabled boolean not null default false,
 template_id uuid,
 country_code text not null default '91' check (country_code ~ '^[1-9][0-9]{0,3}$'),
 updated_at timestamptz not null default now(),
 foreign key (organization_id, template_id) references public.crm_whatsapp_templates(organization_id, id),
 check (not enabled or template_id is not null)
);
create table public.crm_whatsapp_followup_jobs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 lead_id uuid not null,
 follow_up_at timestamptz not null,
 template_id uuid not null,
 outbox_id uuid references public.crm_whatsapp_outbox(id),
 status text not null default 'processing' check (status in ('processing','sent','failed','skipped','needs_human')),
 reason text not null default '' check (length(reason) <= 500),
 claim_token uuid not null default gen_random_uuid(),
 created_at timestamptz not null default now(),
 foreign key (organization_id, lead_id) references public.crm_leads(organization_id, id) on delete cascade,
 foreign key (organization_id, template_id) references public.crm_whatsapp_templates(organization_id, id),
 -- At most one automatic message per follow-up date.
 unique (organization_id, lead_id, follow_up_at)
);
alter table public.crm_whatsapp_templates enable row level security;
alter table public.crm_whatsapp_followup_settings enable row level security;
alter table public.crm_whatsapp_followup_jobs enable row level security;
revoke all on public.crm_whatsapp_templates, public.crm_whatsapp_followup_settings, public.crm_whatsapp_followup_jobs from public, anon, authenticated;
grant select on public.crm_whatsapp_templates, public.crm_whatsapp_followup_settings, public.crm_whatsapp_followup_jobs to authenticated;
grant all on public.crm_whatsapp_templates, public.crm_whatsapp_followup_settings, public.crm_whatsapp_followup_jobs to service_role;
create policy whatsapp_templates_admin on public.crm_whatsapp_templates for select to authenticated
 using (organization_id = public.crm_organization_id() and public.crm_role() in ('owner','admin'));
create policy whatsapp_followup_settings_admin on public.crm_whatsapp_followup_settings for select to authenticated
 using (organization_id = public.crm_organization_id() and public.crm_role() in ('owner','admin'));
create policy whatsapp_followup_jobs_visible on public.crm_whatsapp_followup_jobs for select to authenticated
 using (organization_id = public.crm_organization_id() and public.crm_lead_view(lead_id));

-- A lead's phone as a WhatsApp number: digits only, local 10-digit numbers get the
-- workspace's country code, and a leading trunk 0 is dropped.
create function public.crm_whatsapp_number(phone text, country_code text) returns text
language sql immutable set search_path='' as $$
 select case
  when d ~ '^0[0-9]{10}$' then country_code||substr(d,2)
  when d ~ '^[0-9]{10}$' then country_code||d
  when d ~ '^[1-9][0-9]{10,14}$' then d
 end
 from (select regexp_replace(coalesce(phone,''),'[^0-9]','','g') d) x
$$;

-- Due: an open, unconverted lead whose follow-up passed in the last 7 days (enabling the
-- feature never messages a backlog), with a usable number, no logged contact or WhatsApp
-- message since the follow-up time, no opt-out, and no earlier attempt for this date. The
-- workspace needs follow-ups on, a Gupshup connection, an active paid period, and the
-- sending member (assigned agent, else the owner) with an active seat.
create function public.crm_whatsapp_followup_due(org uuid, lead uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.crm_leads l
  join public.crm_stages s on s.id=l.stage_id and s.organization_id=l.organization_id
  join public.crm_whatsapp_followup_settings fs on fs.organization_id=l.organization_id and fs.enabled
  join public.crm_whatsapp_connections w on w.organization_id=l.organization_id and w.active and w.provider='gupshup'
  where l.id=lead and l.organization_id=org and l.client_id is null and s.kind='open'
   and l.follow_up<=now() and l.follow_up>now()-interval '7 days'
   and public.crm_whatsapp_number(l.phone, fs.country_code) is not null
   and exists(select 1 from public.crm_usage_periods where organization_id=org and starts_at<=now() and ends_at>now() and trial_budget_paise is null)
   and not exists(select 1 from public.crm_whatsapp_followup_jobs j where j.organization_id=org and j.lead_id=l.id and j.follow_up_at=l.follow_up)
   and not exists(select 1 from public.crm_activities a where a.organization_id=org and a.lead_id=l.id and a.created_at>=l.follow_up and a.kind in ('note','call','meeting','task'))
   and not exists(select 1 from public.crm_whatsapp_conversations c
    where c.organization_id=org and (c.lead_id=l.id or (c.connection_id=w.id and c.sender=public.crm_whatsapp_number(l.phone, fs.country_code)))
     and (c.last_message_at>=l.follow_up or exists(select 1 from public.crm_whatsapp_messages msg
      where msg.conversation_id=c.id and msg.body ~* '(^|[^a-z])(stop|unsubscribe|opt out)([^a-z]|$)')))
   and public.crm_member_seat_active(coalesce(l.owner_id,
    (select m.id from public.crm_members m where m.organization_id=org and m.role='owner' limit 1)))
 )
$$;

-- Claims one due follow-up across all workspaces, renders the template, opens (or reuses)
-- the lead's conversation, reserves usage and queues the outbox row. Returns what the
-- worker needs to send, or null when nothing is due. A reservation failure (allowance or
-- budget used up) records the job as needs_human instead of retrying it forever.
create function public.crm_claim_whatsapp_followup(cost_paise bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.crm_leads; fs public.crm_whatsapp_followup_settings; t public.crm_whatsapp_templates;
 w public.crm_whatsapp_connections; job public.crm_whatsapp_followup_jobs; chat public.crm_whatsapp_conversations;
 sending_member uuid; agent text; business text; number text; params text[] := '{}'; value text; rendered text; i integer;
 reservation uuid; item public.crm_whatsapp_outbox;
begin
 select ld.* into l from public.crm_leads ld
 where ld.follow_up<=now() and ld.follow_up>now()-interval '7 days'
   and public.crm_whatsapp_followup_due(ld.organization_id, ld.id)
 order by ld.follow_up, ld.id limit 1 for update skip locked;
 if not found then return null; end if;
 select * into fs from public.crm_whatsapp_followup_settings where organization_id=l.organization_id;
 select * into t from public.crm_whatsapp_templates where id=fs.template_id and organization_id=l.organization_id;
 select * into w from public.crm_whatsapp_connections where organization_id=l.organization_id;
 sending_member := coalesce(l.owner_id, (select m.id from public.crm_members m where m.organization_id=l.organization_id and m.role='owner' limit 1));
 select name into agent from public.crm_members where id=sending_member;
 select name into business from public.crm_organizations where id=l.organization_id;
 number := public.crm_whatsapp_number(l.phone, fs.country_code);
 insert into public.crm_whatsapp_followup_jobs(organization_id,lead_id,follow_up_at,template_id)
 values(l.organization_id,l.id,l.follow_up,t.id) returning * into job;
 for i in 1..coalesce(cardinality(t.params),0) loop
  value := case t.params[i]
   when 'lead_first_name' then split_part(trim(l.name),' ',1)
   when 'lead_name' then trim(l.name)
   when 'agent_name' then agent
   when 'business_name' then business
   when 'service' then coalesce(nullif(trim(l.service),''),'your enquiry')
   when 'follow_up_date' then to_char(l.follow_up at time zone 'Asia/Kolkata','DD Mon')
  end;
  params := params || coalesce(nullif(trim(value),''),'there');
 end loop;
 rendered := t.body;
 for i in 1..coalesce(cardinality(params),0) loop rendered := replace(rendered,'{{'||i||'}}',params[i]); end loop;
 select * into chat from public.crm_whatsapp_conversations c where c.connection_id=w.id and c.sender=number;
 if not found then
  insert into public.crm_whatsapp_conversations(organization_id,connection_id,lead_id,sender,contact_name,last_message_at)
  values(l.organization_id,w.id,l.id,number,left(trim(l.name),200),now()-interval '1 year') returning * into chat;
 end if;
 begin
  reservation := public.crm_reserve_usage(l.organization_id,'wa-followup:'||job.id::text,'whatsapp',1,cost_paise);
 exception when others then
  update public.crm_whatsapp_followup_jobs set status='needs_human',reason=left('Not sent: '||sqlerrm,500) where id=job.id;
  return jsonb_build_object('job',job.id,'run',false);
 end;
 insert into public.crm_whatsapp_outbox(organization_id,conversation_id,usage_event_id,approved_by,body,origin,request_key)
 values(l.organization_id,chat.id,reservation,sending_member,left(rendered,3000),'followup','followup:'||job.id::text) returning * into item;
 update public.crm_whatsapp_followup_jobs set outbox_id=item.id where id=job.id;
 return jsonb_build_object('job',job.id,'token',job.claim_token,'run',true,'outbox',item.id,'organization',l.organization_id,
  'recipient',number,'phone',w.phone_number_id,'template',t.provider_template_id,'params',to_jsonb(params),'body',item.body);
end $$;

-- Records the outcome on the job and, once sent, on the lead's activity history.
create function public.crm_end_whatsapp_followup(job uuid, token uuid, outcome text, explanation text) returns void
language plpgsql security definer set search_path='' as $$
declare j public.crm_whatsapp_followup_jobs; t public.crm_whatsapp_templates;
begin
 if outcome not in ('sent','failed','needs_human') then raise exception 'Invalid outcome'; end if;
 select * into j from public.crm_whatsapp_followup_jobs where id=job and claim_token=token for update;
 if not found then raise exception 'Unknown follow-up job'; end if;
 if j.status<>'processing' then return; end if;
 update public.crm_whatsapp_followup_jobs set status=outcome,reason=left(coalesce(explanation,''),500) where id=j.id;
 if outcome='sent' then
  select * into t from public.crm_whatsapp_templates where id=j.template_id;
  insert into public.crm_activities(organization_id,lead_id,kind,body)
  values(j.organization_id,j.lead_id,'updated','Automatic WhatsApp follow-up sent ('||t.label||').');
 end if;
end $$;
-- Heartbeat, and stuck sends become failed for review: never resent automatically.
create function public.crm_whatsapp_followup_maintenance() returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.crm_worker_health(id,last_seen) values('whatsapp-followups',now()) on conflict(id) do update set last_seen=now();
 update public.crm_whatsapp_followup_jobs set status='failed',reason='Worker interrupted; check WhatsApp before resending'
 where status='processing' and created_at<now()-interval '5 minutes';
end $$;
revoke all on function public.crm_whatsapp_followup_maintenance() from public,anon,authenticated;
grant execute on function public.crm_whatsapp_followup_maintenance() to service_role;

revoke all on function public.crm_whatsapp_number(text,text), public.crm_whatsapp_followup_due(uuid,uuid),
 public.crm_claim_whatsapp_followup(bigint), public.crm_end_whatsapp_followup(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_claim_whatsapp_followup(bigint), public.crm_end_whatsapp_followup(uuid,uuid,text,text) to service_role;
commit;
