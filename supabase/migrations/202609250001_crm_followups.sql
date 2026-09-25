-- Automated SMS/email follow-ups for leads whose follow-up date has passed with no activity since.
-- Independent of the WhatsApp auto-reply system: time-triggered (cron-polled), not message-triggered.
begin;
alter table public.crm_usage_events drop constraint crm_usage_events_kind_check;
alter table public.crm_usage_events add constraint crm_usage_events_kind_check
 check(kind in ('ai','whatsapp','overhead','sms','email'));

-- Re-declares crm_reserve_usage (last redefined in 202609240003_crm_trial_replies.sql) to accept
-- the two new kinds. Everything else, including the trial-budget restriction to ai/whatsapp only,
-- is unchanged: trial orgs can still draft follow-ups but cannot send SMS/email on a trial budget.
create or replace function public.crm_reserve_usage(org uuid, request_key text, usage_kind text, quantity integer, max_cost_paise bigint)
 returns uuid language plpgsql security definer set search_path='' as $$
declare p public.crm_usage_periods; old public.crm_usage_events; spent bigint; used bigint; allowance integer; result uuid;
begin
 if request_key is null or length(request_key) not between 1 and 200
   or usage_kind is null or usage_kind not in ('ai','whatsapp','overhead','sms','email')
   or quantity is null or quantity <= 0 or max_cost_paise is null or max_cost_paise <= 0
 then raise exception 'Invalid usage reservation'; end if;
 select * into p from public.crm_usage_periods where organization_id=org and starts_at<=now() and ends_at>now() for update;
 if not found then raise exception 'No active usage period'; end if;
 -- A replay is only a receipt; the caller must never dispatch the provider call again.
 select * into old from public.crm_usage_events where organization_id=org and event_key=request_key;
 if found then
   if old.period_id<>p.id or old.kind<>usage_kind or old.units<>quantity or old.reserved_paise<>max_cost_paise
   then raise exception 'Usage key conflict'; end if;
   raise exception 'Usage already reserved' using errcode='23505';
 end if;
 if p.trial_budget_paise is not null and usage_kind<>'ai' and (usage_kind<>'whatsapp' or p.whatsapp_limit=0) then raise exception 'Trial permits AI drafts only'; end if;
 if p.trial_budget_paise is null and not exists(select 1 from public.crm_subscriptions where organization_id=org and active)
 then raise exception 'Subscription inactive'; end if;
 select coalesce(sum(case when status='settled' then actual_paise else reserved_paise end),0),
   coalesce(sum(case when kind=usage_kind then units else 0 end),0)
 into spent,used from public.crm_usage_events where period_id=p.id and status<>'cancelled';
 if p.overhead_paise + spent + max_cost_paise > p.cost_ceiling_paise
 then raise exception 'Service budget reached'; end if;
 allowance := case usage_kind when 'ai' then p.ai_limit when 'whatsapp' then p.whatsapp_limit else null end;
 if allowance is not null and used+quantity>allowance then raise exception 'Usage allowance reached'; end if;
 insert into public.crm_usage_events(organization_id,period_id,event_key,kind,units,reserved_paise)
 values(org,p.id,request_key,usage_kind,quantity,max_cost_paise) returning id into result;
 return result;
end $$;

alter table public.crm_ai_settings add column followup_enabled boolean not null default false;
alter table public.crm_ai_settings add column followup_actor uuid references public.crm_members(id);

create table public.crm_followup_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 lead_id uuid not null, follow_up_at timestamptz not null,
 actor uuid not null references public.crm_members(id), settings_at timestamptz not null,
 usage_event_id uuid not null,
 status text not null default 'processing' check(status in ('processing','complete','skipped','needs_human','failed')),
 claim_token uuid not null default gen_random_uuid(),
 sms_text text not null default '' check(length(sms_text)<=320),
 email_subject text not null default '' check(length(email_subject)<=200),
 email_body text not null default '' check(length(email_body)<=4000),
 reason text not null default '' check(length(reason)<=500),
 created_at timestamptz not null default now(),
 foreign key(organization_id,lead_id) references public.crm_leads(organization_id,id),
 foreign key(organization_id,usage_event_id) references public.crm_usage_events(organization_id,id),
 unique(organization_id,id), unique(organization_id,lead_id,follow_up_at)
);
create index crm_followup_jobs_org_status on public.crm_followup_jobs(organization_id,status,created_at);

create table public.crm_followup_sends (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 job_id uuid not null, lead_id uuid not null,
 channel text not null check(channel in ('sms','email')),
 recipient text not null check(length(recipient) between 1 and 320),
 usage_event_id uuid not null,
 status text not null default 'dispatching' check(status in ('dispatching','accepted','rejected','unknown')),
 provider_message_id text check(provider_message_id is null or length(provider_message_id) between 1 and 500),
 created_at timestamptz not null default now(),
 foreign key(organization_id,job_id) references public.crm_followup_jobs(organization_id,id),
 foreign key(organization_id,lead_id) references public.crm_leads(organization_id,id),
 foreign key(organization_id,usage_event_id) references public.crm_usage_events(organization_id,id),
 unique(organization_id,job_id,channel)
);

alter table public.crm_followup_jobs enable row level security;
alter table public.crm_followup_sends enable row level security;
revoke all on public.crm_followup_jobs,public.crm_followup_sends from public,anon,authenticated;
grant all on public.crm_followup_jobs,public.crm_followup_sends to service_role;
grant select(id,organization_id,lead_id,status,reason,created_at) on public.crm_followup_jobs to authenticated;
grant select(id,organization_id,job_id,lead_id,channel,status,created_at) on public.crm_followup_sends to authenticated;
create policy followup_jobs_admin on public.crm_followup_jobs for select to authenticated
 using(organization_id=public.crm_organization_id() and public.crm_role() in ('owner','admin'));
create policy followup_sends_admin on public.crm_followup_sends for select to authenticated
 using(organization_id=public.crm_organization_id() and public.crm_role() in ('owner','admin'));

create function public.crm_set_followups(enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare org uuid; settings public.crm_ai_settings;
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 if enabled is null then raise exception 'Invalid setting'; end if;
 org:=public.crm_organization_id();
 select * into settings from public.crm_ai_settings where organization_id=org for update;
 if not found then raise exception 'Save company knowledge first'; end if;
 if enabled and (not settings.drafts_enabled or length(trim(settings.knowledge))<20) then raise exception 'Enable drafts and save company knowledge first'; end if;
 if enabled and not exists(select 1 from public.crm_usage_periods where organization_id=org and starts_at<=now() and ends_at>now() and ai_limit>0) then raise exception 'An active AI allowance is required'; end if;
 update public.crm_ai_settings set followup_enabled=enabled,followup_actor=case when enabled then auth.uid() else null end,updated_at=clock_timestamp() where organization_id=org;
end $$;

-- Finds one eligible lead across ALL organizations with follow-ups enabled (follow-up date reached,
-- still open, no activity since, no job for this specific follow-up value yet) and atomically claims
-- it by inserting the job row already reserved. Mirrors crm_claim_auto_reply's "any tenant's oldest
-- due work" shape, since there is no per-tenant queue to poll: eligibility is computed on read.
create function public.crm_claim_followup(maximum_cost bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare picked uuid; lead public.crm_leads; org uuid; settings public.crm_ai_settings; reservation uuid; result public.crm_followup_jobs;
begin
 select l.id into picked from public.crm_leads l
  join public.crm_stages s on s.organization_id=l.organization_id and s.id=l.stage_id
  join public.crm_ai_settings ai on ai.organization_id=l.organization_id
  where l.client_id is null and s.kind='open' and ai.followup_enabled and ai.drafts_enabled
  and length(trim(ai.knowledge))>=20 and ai.followup_actor is not null
  and exists(select 1 from public.crm_members m where m.id=ai.followup_actor and m.organization_id=l.organization_id and m.role in ('owner','admin'))
  and l.follow_up is not null and l.follow_up<=now()
  and (nullif(trim(l.phone),'') is not null or nullif(trim(l.email),'') is not null)
  and not exists(select 1 from public.crm_followup_jobs j where j.organization_id=l.organization_id and j.lead_id=l.id and j.follow_up_at=l.follow_up)
  -- Only a human-logged interaction counts as "followed up"; system bookkeeping activities
  -- (created/stage/converted/updated, auto-logged by crm_lead_after on every insert/update)
  -- must never suppress a nudge that's actually due.
  and not exists(select 1 from public.crm_activities a where a.organization_id=l.organization_id and a.lead_id=l.id and a.created_at>=l.follow_up and a.kind in ('note','call','meeting','task'))
  order by l.follow_up limit 1 for update of l skip locked;
 if picked is null then return null; end if;
 select * into lead from public.crm_leads where id=picked;
 org:=lead.organization_id;
 select * into settings from public.crm_ai_settings where organization_id=org;
 reservation:=public.crm_reserve_usage(org,'followup-ai:'||lead.id::text||':'||extract(epoch from lead.follow_up)::text,'ai',1,maximum_cost);
 insert into public.crm_followup_jobs(organization_id,lead_id,follow_up_at,actor,settings_at,usage_event_id)
  values(org,lead.id,lead.follow_up,settings.followup_actor,settings.updated_at,reservation) returning * into result;
 return jsonb_build_object('id',result.id,'token',result.claim_token,'knowledge',settings.knowledge,
   'lead',jsonb_build_object('name',lead.name,'company',lead.company,'service',lead.service,'phone',lead.phone,'email',lead.email,'notes',left(lead.notes,1500)));
end $$;

create function public.crm_finish_followup_draft(job uuid, token uuid, sms_answer text, subject_answer text, email_answer text, explanation text, actual_cost_paise bigint)
 returns void language plpgsql security definer set search_path='' as $$
declare item public.crm_followup_jobs;
begin
 select * into item from public.crm_followup_jobs where id=job and claim_token=token and status='processing' for update;
 if not found then raise exception 'Job unavailable'; end if;
 perform public.crm_finish_usage(item.organization_id,item.usage_event_id,coalesce(actual_cost_paise,0),actual_cost_paise is null);
 update public.crm_followup_jobs set sms_text=left(coalesce(sms_answer,''),320),email_subject=left(coalesce(subject_answer,''),200),
  email_body=left(coalesce(email_answer,''),4000),reason=left(coalesce(explanation,''),500) where id=job;
end $$;

-- Re-validates the lead is still eligible right before dispatch (it may have changed since claim)
-- and reserves the channel's send cost. Returns run=false when the channel is unusable or already sent.
create function public.crm_prepare_followup_send(job uuid, token uuid, requested_channel text, cost_paise bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.crm_followup_jobs; lead public.crm_leads; reservation uuid; dispatch public.crm_followup_sends; recipient text; message_body text;
begin
 if requested_channel not in ('sms','email') then raise exception 'Invalid channel'; end if;
 select * into item from public.crm_followup_jobs where id=job and claim_token=token and status='processing' for update;
 if not found then raise exception 'Job unavailable'; end if;
 if exists(select 1 from public.crm_followup_sends where organization_id=item.organization_id and job_id=job and channel=requested_channel) then return jsonb_build_object('run',false); end if;
 select * into lead from public.crm_leads where id=item.lead_id and organization_id=item.organization_id for update;
 if not found or lead.client_id is not null or lead.follow_up is distinct from item.follow_up_at then return jsonb_build_object('run',false); end if;
 if requested_channel='sms' then recipient:=nullif(trim(lead.phone),''); message_body:=item.sms_text;
 else recipient:=nullif(trim(lead.email),''); message_body:=item.email_body; end if;
 if recipient is null or trim(coalesce(message_body,''))='' then return jsonb_build_object('run',false); end if;
 reservation:=public.crm_reserve_usage(item.organization_id,'followup-'||requested_channel||':'||job::text,requested_channel,1,cost_paise);
 insert into public.crm_followup_sends(organization_id,job_id,lead_id,channel,recipient,usage_event_id)
  values(item.organization_id,job,item.lead_id,requested_channel,recipient,reservation) returning * into dispatch;
 return jsonb_build_object('run',true,'id',dispatch.id,'recipient',recipient,'body',message_body,'subject',case when requested_channel='email' then item.email_subject else null end);
end $$;

-- Mirrors crm_finish_whatsapp_reply exactly: accepted settles actual cost, rejected cancels the
-- reservation, unknown leaves it reserved for manual reconciliation and is never auto-retried.
create function public.crm_finish_followup_send(send_id uuid, token uuid, outcome text, message_id text, cost_paise bigint) returns void language plpgsql security definer set search_path='' as $$
declare item public.crm_followup_sends; job public.crm_followup_jobs;
begin
 if outcome not in ('accepted','rejected','unknown') or outcome is null then raise exception 'Invalid outcome'; end if;
 if outcome='accepted' and (message_id is null or length(message_id) not between 1 and 500) then raise exception 'Missing provider receipt'; end if;
 select * into item from public.crm_followup_sends where id=send_id for update;
 if not found then raise exception 'Unknown send attempt'; end if;
 select * into job from public.crm_followup_jobs where id=item.job_id and claim_token=token;
 if not found then raise exception 'Job token mismatch'; end if;
 if item.status<>'dispatching' then
  if item.status=outcome and item.provider_message_id is not distinct from message_id then return; end if;
  raise exception 'Attempt already finalized';
 end if;
 if outcome='accepted' then perform public.crm_finish_usage(item.organization_id,item.usage_event_id,cost_paise,false);
 elsif outcome='rejected' then perform public.crm_finish_usage(item.organization_id,item.usage_event_id,0,true);
 end if;
 update public.crm_followup_sends set status=outcome,provider_message_id=message_id where id=send_id;
end $$;

create function public.crm_end_followup(job uuid, token uuid, outcome text, explanation text) returns void language plpgsql security definer set search_path='' as $$
begin
 if outcome not in ('complete','skipped','needs_human','failed') then raise exception 'Invalid outcome'; end if;
 update public.crm_followup_jobs set status=outcome,reason=left(coalesce(explanation,''),500) where id=job and claim_token=token and status='processing';
end $$;

create function public.crm_followup_maintenance() returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.crm_worker_health(id,last_seen) values('followups',now()) on conflict(id) do update set last_seen=now();
 update public.crm_followup_jobs set status='failed',reason='Worker interrupted; review before resuming' where status='processing' and created_at<now()-interval '5 minutes';
end $$;

revoke all on function public.crm_set_followups(boolean),public.crm_claim_followup(bigint),
 public.crm_finish_followup_draft(uuid,uuid,text,text,text,text,bigint),public.crm_prepare_followup_send(uuid,uuid,text,bigint),
 public.crm_finish_followup_send(uuid,uuid,text,text,bigint),public.crm_end_followup(uuid,uuid,text,text),
 public.crm_followup_maintenance() from public,anon,authenticated;
grant execute on function public.crm_set_followups(boolean) to authenticated;
grant execute on function public.crm_claim_followup(bigint),public.crm_finish_followup_draft(uuid,uuid,text,text,text,text,bigint),
 public.crm_prepare_followup_send(uuid,uuid,text,bigint),public.crm_finish_followup_send(uuid,uuid,text,text,bigint),
 public.crm_end_followup(uuid,uuid,text,text),public.crm_followup_maintenance() to service_role;
commit;
