-- Lead capture: every workspace can turn on a private capture link. Enquiries arrive through
-- its hosted form (Instagram bio, ads, QR codes), a website embed, or a webhook that Zapier,
-- Pabbly or Make fill from Facebook/Instagram Lead Ads, Google Ads and property portals.
-- A new lead can be assigned to an agent and greeted at once with an approved WhatsApp
-- template, sent by the existing follow-up worker. A repeat enquiry from the same phone or
-- email is added to the open lead's history instead of creating a duplicate.
begin;

create table public.crm_lead_capture (
 organization_id uuid primary key references public.crm_organizations(id),
 token text not null unique check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
 enabled boolean not null default true,
 welcome_template_id uuid,
 assign_to uuid references public.crm_members(id) on delete set null,
 updated_at timestamptz not null default now(),
 foreign key (organization_id, welcome_template_id) references public.crm_whatsapp_templates(organization_id, id)
);
create table public.crm_lead_capture_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.crm_organizations(id),
 lead_id uuid,
 status text not null check (status in ('created','existing','ignored')),
 source text not null default '' check (length(source) <= 100),
 phone text not null default '' check (length(phone) <= 40),
 email text not null default '' check (length(email) <= 200),
 created_at timestamptz not null default now(),
 foreign key (organization_id, lead_id) references public.crm_leads(organization_id, id) on delete cascade
);
create index crm_lead_capture_events_org on public.crm_lead_capture_events(organization_id, created_at desc);
alter table public.crm_lead_capture enable row level security;
alter table public.crm_lead_capture_events enable row level security;
revoke all on public.crm_lead_capture, public.crm_lead_capture_events from public, anon, authenticated;
grant select on public.crm_lead_capture, public.crm_lead_capture_events to authenticated;
grant all on public.crm_lead_capture, public.crm_lead_capture_events to service_role;
create policy lead_capture_admin on public.crm_lead_capture for select to authenticated
 using (organization_id = public.crm_organization_id() and public.crm_role() in ('owner','admin'));
create policy lead_capture_events_admin on public.crm_lead_capture_events for select to authenticated
 using (organization_id = public.crm_organization_id() and public.crm_role() in ('owner','admin'));

-- When a captured lead is due its welcome message (null: none).
alter table public.crm_leads add column welcome_at timestamptz;
create index crm_leads_welcome on public.crm_leads(welcome_at) where welcome_at is not null;

-- Saves one enquiry from a capture link. Returns {status, lead}: 'created', 'existing' (added
-- to an open lead with the same phone or email from the last 90 days) or 'ignored' (the same
-- contact already sent 3 in the last hour). Raises for an unknown or switched-off link, a
-- missing name or contact, or more than 300 enquiries an hour for the workspace.
create function public.crm_capture_workspace_lead(capture_token text, contact_name text, contact_phone text,
 contact_email text, looking_for text, budget_inr numeric, contact_notes text, lead_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cap public.crm_lead_capture; country text; digits text; mail text; src text; existing uuid; lead uuid;
 first_stage uuid; owner uuid;
begin
 select * into cap from public.crm_lead_capture where token=capture_token and enabled;
 if not found then raise exception 'This enquiry form is not available' using errcode='P0404'; end if;
 contact_name := left(trim(coalesce(contact_name,'')),200);
 mail := lower(left(trim(coalesce(contact_email,'')),200));
 if mail <> '' and mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then mail := ''; end if;
 select coalesce((select country_code from public.crm_whatsapp_followup_settings where organization_id=cap.organization_id),'91') into country;
 digits := coalesce(public.crm_whatsapp_number(contact_phone, country), '');
 if contact_name = '' then contact_name := coalesce(nullif(split_part(mail,'@',1),''), nullif(digits,''), ''); end if;
 if contact_name = '' or (digits = '' and mail = '') then raise exception 'Enter a name and a phone number or email'; end if;
 src := coalesce(nullif(left(trim(coalesce(lead_source,'')),100),''),'Website form');

 perform pg_advisory_xact_lock(hashtextextended(cap.organization_id::text||':capture:'||coalesce(nullif(digits,''),mail),3));
 if (select count(*) from public.crm_lead_capture_events where organization_id=cap.organization_id and created_at>now()-interval '1 hour') >= 300 then
  raise exception 'Too many enquiries right now. Try again later.';
 end if;
 if (select count(*) from public.crm_lead_capture_events e where e.organization_id=cap.organization_id and e.created_at>now()-interval '1 hour'
   and ((digits<>'' and e.phone=digits) or (mail<>'' and e.email=mail))) >= 3 then
  insert into public.crm_lead_capture_events(organization_id,status,source,phone,email) values(cap.organization_id,'ignored',src,digits,mail);
  return jsonb_build_object('status','ignored');
 end if;

 select l.id into existing from public.crm_leads l join public.crm_stages s on s.id=l.stage_id
 where l.organization_id=cap.organization_id and s.kind='open' and l.client_id is null and l.created_at>now()-interval '90 days'
  and ((digits<>'' and public.crm_whatsapp_number(l.phone, country)=digits) or (mail<>'' and lower(l.email)=mail))
 order by l.created_at desc limit 1;
 if existing is not null then
  update public.crm_leads set
   phone=case when phone='' and digits<>'' then left(trim(contact_phone),200) else phone end,
   email=case when email='' then mail else email end,
   service=case when service='' then left(trim(coalesce(looking_for,'')),200) else service end
  where id=existing;
  insert into public.crm_activities(organization_id,lead_id,kind,body)
  values(cap.organization_id,existing,'updated',left('Enquired again via '||src||coalesce(': '||nullif(trim(concat_ws(' · ',nullif(trim(looking_for),''),nullif(trim(contact_notes),''))),''),'')||'.',5000));
  insert into public.crm_lead_capture_events(organization_id,lead_id,status,source,phone,email) values(cap.organization_id,existing,'existing',src,digits,mail);
  return jsonb_build_object('status','existing','lead',existing);
 end if;

 select id into first_stage from public.crm_stages where organization_id=cap.organization_id and kind='open' order by position,id limit 1;
 if first_stage is null then raise exception 'Workspace stages are incomplete'; end if;
 if cap.assign_to is not null and exists(select 1 from public.crm_members where id=cap.assign_to and organization_id=cap.organization_id) then
  owner := cap.assign_to;
 end if;
 insert into public.crm_leads(organization_id,name,phone,email,service,value,notes,source,stage_id,owner_id,welcome_at)
 values(cap.organization_id,contact_name,left(trim(coalesce(contact_phone,'')),200),mail,left(trim(coalesce(looking_for,'')),200),
  case when budget_inr between 1 and 1000000000000 then round(budget_inr,2) else 0 end,
  left(trim(coalesce(contact_notes,'')),5000),src,first_stage,owner,
  case when cap.welcome_template_id is not null and digits<>'' then now() end)
 returning id into lead;
 insert into public.crm_activities(organization_id,lead_id,kind,body) values(cap.organization_id,lead,'updated','Captured from '||src||'.');
 insert into public.crm_lead_capture_events(organization_id,lead_id,status,source,phone,email) values(cap.organization_id,lead,'created',src,digits,mail);
 return jsonb_build_object('status','created','lead',lead);
end $$;
revoke all on function public.crm_capture_workspace_lead(text,text,text,text,text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.crm_capture_workspace_lead(text,text,text,text,text,numeric,text,text) to service_role;

-- Claims one due welcome message, in the same shape as crm_claim_whatsapp_followup so the
-- same worker sends it and records it as a follow-up job. Due: an open, unconverted lead
-- captured in the last 2 hours with a welcome time, a usable number, no earlier attempt, no
-- WhatsApp message with that number since capture (they or the agent are already talking)
-- and no opt-out; the workspace needs its capture link on with a welcome template, Gupshup
-- connected, an active paid period and a sending member with an active seat.
create function public.crm_claim_lead_welcome(cost_paise bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.crm_leads; cap public.crm_lead_capture; t public.crm_whatsapp_templates;
 w public.crm_whatsapp_connections; job public.crm_whatsapp_followup_jobs; chat public.crm_whatsapp_conversations;
 sending_member uuid; agent text; business text; country text; number text; params text[] := '{}'; value text; rendered text; i integer;
 reservation uuid; item public.crm_whatsapp_outbox;
begin
 select ld.* into l from public.crm_leads ld
 join public.crm_stages s on s.id=ld.stage_id and s.organization_id=ld.organization_id and s.kind='open'
 join public.crm_lead_capture c on c.organization_id=ld.organization_id and c.enabled and c.welcome_template_id is not null
 join public.crm_whatsapp_connections wc on wc.organization_id=ld.organization_id and wc.active and wc.provider='gupshup'
 where ld.welcome_at<=now() and ld.welcome_at>now()-interval '2 hours' and ld.client_id is null
  and exists(select 1 from public.crm_usage_periods p where p.organization_id=ld.organization_id and p.starts_at<=now() and p.ends_at>now() and p.trial_budget_paise is null)
  and not exists(select 1 from public.crm_whatsapp_followup_jobs j where j.organization_id=ld.organization_id and j.lead_id=ld.id and j.follow_up_at=ld.welcome_at)
 order by ld.welcome_at, ld.id limit 1 for update of ld skip locked;
 if not found then return null; end if;
 select * into cap from public.crm_lead_capture where organization_id=l.organization_id;
 select * into t from public.crm_whatsapp_templates where id=cap.welcome_template_id and organization_id=l.organization_id;
 select * into w from public.crm_whatsapp_connections where organization_id=l.organization_id;
 select coalesce((select country_code from public.crm_whatsapp_followup_settings where organization_id=l.organization_id),'91') into country;
 number := public.crm_whatsapp_number(l.phone, country);
 sending_member := coalesce(l.owner_id, (select m.id from public.crm_members m where m.organization_id=l.organization_id and m.role='owner' limit 1));
 insert into public.crm_whatsapp_followup_jobs(organization_id,lead_id,follow_up_at,template_id)
 values(l.organization_id,l.id,l.welcome_at,t.id) returning * into job;
 select * into chat from public.crm_whatsapp_conversations c where c.connection_id=w.id and c.sender=number;
 -- Not sent, recorded once so it isn't picked again.
 if number is null or not public.crm_member_seat_active(sending_member)
   or (chat.id is not null and (chat.last_message_at>=l.welcome_at or public.crm_whatsapp_opted_out(chat.id))) then
  update public.crm_whatsapp_followup_jobs set status='skipped',
   reason=case when number is null then 'No usable WhatsApp number'
    when not public.crm_member_seat_active(sending_member) then 'The assigned agent has no active seat'
    when public.crm_whatsapp_opted_out(chat.id) then 'Contact asked not to be messaged'
    else 'Already chatting on WhatsApp' end
  where id=job.id;
  return jsonb_build_object('job',job.id,'run',false,'skipped',true);
 end if;
 select name into agent from public.crm_members where id=sending_member;
 select name into business from public.crm_organizations where id=l.organization_id;
 for i in 1..coalesce(cardinality(t.params),0) loop
  value := case t.params[i]
   when 'lead_first_name' then split_part(trim(l.name),' ',1)
   when 'lead_name' then trim(l.name)
   when 'agent_name' then agent
   when 'business_name' then business
   when 'service' then coalesce(nullif(trim(l.service),''),'your enquiry')
   when 'follow_up_date' then to_char(l.welcome_at at time zone 'Asia/Kolkata','DD Mon')
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
  reservation := public.crm_reserve_usage(l.organization_id,'wa-welcome:'||job.id::text,'whatsapp',1,cost_paise);
 exception when others then
  update public.crm_whatsapp_followup_jobs set status='needs_human',reason=left('Welcome not sent: '||sqlerrm,500) where id=job.id;
  return jsonb_build_object('job',job.id,'run',false);
 end;
 insert into public.crm_whatsapp_outbox(organization_id,conversation_id,usage_event_id,approved_by,body,origin,request_key)
 values(l.organization_id,chat.id,reservation,sending_member,left(rendered,3000),'followup','welcome:'||job.id::text) returning * into item;
 update public.crm_whatsapp_followup_jobs set outbox_id=item.id where id=job.id;
 return jsonb_build_object('job',job.id,'token',job.claim_token,'run',true,'outbox',item.id,'organization',l.organization_id,
  'recipient',number,'phone',w.phone_number_id,'template',t.provider_template_id,'params',to_jsonb(params),'body',item.body);
end $$;
revoke all on function public.crm_claim_lead_welcome(bigint) from public, anon, authenticated;
grant execute on function public.crm_claim_lead_welcome(bigint) to service_role;

-- The lead's history says "Welcome WhatsApp sent" for a welcome rather than "follow-up".
do $$
declare def text;
 old_text constant text := '''Automatic WhatsApp follow-up sent (''||t.label||'').''';
begin
 select pg_get_functiondef('public.crm_end_whatsapp_followup(uuid,uuid,text,text)'::regprocedure) into def;
 if position(old_text in def) = 0 then raise exception 'crm_end_whatsapp_followup is not the expected version'; end if;
 execute replace(def, old_text,
  'case when exists(select 1 from public.crm_leads ld where ld.id=j.lead_id and ld.welcome_at=j.follow_up_at) '
  || 'then ''Welcome WhatsApp sent ('' else ''Automatic WhatsApp follow-up sent ('' end||t.label||'').''');
end $$;

commit;
