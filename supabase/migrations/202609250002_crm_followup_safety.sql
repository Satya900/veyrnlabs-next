begin;
-- Upgrade already-installed follow-ups without replaying historical migrations.
alter table public.crm_ai_settings add column followup_retry_after timestamptz;
alter table public.crm_followup_jobs add column recipient_email text;
alter table public.crm_followup_jobs add column recipient_phone text;
-- Older unfinished drafts lack recipient snapshots and must not be dispatched.
alter table public.crm_followup_jobs drop constraint crm_followup_jobs_actor_fkey;
alter table public.crm_ai_settings drop constraint crm_ai_settings_followup_actor_fkey;
alter table public.crm_ai_settings add constraint crm_ai_settings_followup_actor_fkey foreign key(followup_actor) references public.crm_members(id) on delete set null;

create function public.crm_followup_eligible(org uuid, lead uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.crm_leads l
 join public.crm_stages s on s.id=l.stage_id and s.organization_id=l.organization_id
 join public.crm_ai_settings ai on ai.organization_id=l.organization_id
 where l.id=lead and l.organization_id=org and l.client_id is null and s.kind='open'
 and l.follow_up<=now() and nullif(trim(l.email),'') is not null
 and ai.followup_enabled and ai.drafts_enabled and length(trim(ai.knowledge))>=20
 and exists(select 1 from public.crm_members m where m.id=ai.followup_actor and m.organization_id=org and m.role in ('owner','admin') and public.crm_member_seat_active(m.id))
 and exists(select 1 from public.crm_subscriptions where organization_id=org and active)
 and exists(select 1 from public.crm_usage_periods where organization_id=org and starts_at<=now() and ends_at>now() and trial_budget_paise is null)
 and not exists(select 1 from public.crm_activities a where a.organization_id=org and a.lead_id=l.id and a.created_at>=l.follow_up and a.kind in ('note','call','meeting','task'))
 and not exists(select 1 from public.crm_whatsapp_conversations c where c.organization_id=org and c.lead_id=l.id and (c.ai_paused or c.last_message_at>=l.follow_up))
 )
$$;
revoke all on function public.crm_followup_eligible(uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_followup_eligible(uuid,uuid) to service_role;

create or replace function public.crm_claim_followup(maximum_cost bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare picked uuid; lead public.crm_leads; org uuid; settings public.crm_ai_settings; reservation uuid; result public.crm_followup_jobs; attempts integer:=0;
begin
 if maximum_cost is null or maximum_cost<=0 then raise exception 'Invalid cost'; end if;
 loop
 attempts:=attempts+1;
 if attempts>50 then return null; end if;
 select l.id into picked from public.crm_leads l
  join public.crm_stages s on s.organization_id=l.organization_id and s.id=l.stage_id
  join public.crm_ai_settings ai on ai.organization_id=l.organization_id
  where public.crm_followup_eligible(l.organization_id,l.id)
  and (ai.followup_retry_after is null or ai.followup_retry_after<=now())
  and not exists(select 1 from public.crm_followup_jobs j where j.organization_id=l.organization_id and j.lead_id=l.id and j.follow_up_at=l.follow_up)
  order by l.follow_up limit 1 for update of l skip locked;
 if picked is null then return null; end if;
 select * into lead from public.crm_leads where id=picked;
 org:=lead.organization_id;
 select * into settings from public.crm_ai_settings where organization_id=org;
 begin
 reservation:=public.crm_reserve_usage(org,'followup-ai:'||lead.id::text||':'||extract(epoch from lead.follow_up)::text,'ai',1,maximum_cost);
 exception when raise_exception then
  update public.crm_ai_settings set followup_retry_after=now()+interval '15 minutes' where organization_id=org;
  continue;
 end;
 insert into public.crm_followup_jobs(organization_id,lead_id,follow_up_at,actor,settings_at,usage_event_id,recipient_email,recipient_phone)
  values(org,lead.id,lead.follow_up,settings.followup_actor,settings.updated_at,reservation,lead.email,lead.phone) returning * into result;
 return jsonb_build_object('id',result.id,'token',result.claim_token,'knowledge',settings.knowledge,
   'lead',jsonb_build_object('name',lead.name,'company',lead.company,'service',lead.service,'phone',lead.phone,'email',lead.email,'notes',left(lead.notes,1500)));
 end loop;
end $$;
create or replace function public.crm_finish_followup_draft(job uuid, token uuid, sms_answer text, subject_answer text, email_answer text, explanation text, actual_cost_paise bigint)
 returns void language plpgsql security definer set search_path='' as $$
declare item public.crm_followup_jobs;
begin
 select * into item from public.crm_followup_jobs where id=job and claim_token=token and status='processing' for update;
 if not found then raise exception 'Job unavailable'; end if;
 -- Unknown provider outcomes remain reserved until evidence-based reconciliation.
 if actual_cost_paise is not null then
  perform public.crm_finish_usage(item.organization_id,item.usage_event_id,actual_cost_paise,false);
 end if;
 update public.crm_followup_jobs set sms_text=left(coalesce(sms_answer,''),320),email_subject=left(coalesce(subject_answer,''),200),
  email_body=left(coalesce(email_answer,''),4000),reason=left(coalesce(explanation,''),500) where id=job;
end $$;
create or replace function public.crm_prepare_followup_send(job uuid, token uuid, requested_channel text, cost_paise bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.crm_followup_jobs; lead public.crm_leads; reservation uuid; dispatch public.crm_followup_sends; recipient text; message_body text; settings public.crm_ai_settings;
begin
 if requested_channel is null or requested_channel not in ('sms','email') then raise exception 'Invalid channel'; end if;
 select * into item from public.crm_followup_jobs where id=job and claim_token=token and status='processing' for update;
 if not found then raise exception 'Job unavailable'; end if;
 select * into settings from public.crm_ai_settings where organization_id=item.organization_id for share;
 if not found or not settings.followup_enabled or not settings.drafts_enabled
 or settings.updated_at is distinct from item.settings_at or settings.followup_actor is distinct from item.actor
 or item.created_at<now()-interval '5 minutes'
 or not public.crm_followup_eligible(item.organization_id,item.lead_id)
 or not exists(select 1 from public.crm_usage_events where id=item.usage_event_id and status='settled')
 then return jsonb_build_object('run',false); end if;
 if exists(select 1 from public.crm_followup_sends where organization_id=item.organization_id and job_id=job and channel=requested_channel) then return jsonb_build_object('run',false); end if;
 select * into lead from public.crm_leads where id=item.lead_id and organization_id=item.organization_id for update;
 if not found or lead.client_id is not null or lead.follow_up is distinct from item.follow_up_at then return jsonb_build_object('run',false); end if;
 if requested_channel='sms' then recipient:=nullif(trim(lead.phone),''); message_body:=item.sms_text;
 else recipient:=nullif(trim(lead.email),''); message_body:=item.email_body; end if;
 if (requested_channel='email' and lead.email is distinct from item.recipient_email)
 or (requested_channel='sms' and lead.phone is distinct from item.recipient_phone) then return jsonb_build_object('run',false); end if;
 if recipient is null or trim(coalesce(message_body,''))='' then return jsonb_build_object('run',false); end if;
 reservation:=public.crm_reserve_usage(item.organization_id,'followup-'||requested_channel||':'||job::text,requested_channel,1,cost_paise);
 insert into public.crm_followup_sends(organization_id,job_id,lead_id,channel,recipient,usage_event_id)
  values(item.organization_id,job,item.lead_id,requested_channel,recipient,reservation) returning * into dispatch;
 return jsonb_build_object('run',true,'id',dispatch.id,'recipient',recipient,'body',message_body,'subject',case when requested_channel='email' then item.email_subject else null end);
end $$;
create or replace function public.crm_member_departure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.crm_ai_settings set auto_enabled=false,auto_actor=null,updated_at=clock_timestamp() where organization_id=old.organization_id and auto_actor=old.id;
 update public.crm_auto_jobs set status='skipped',reason='Automation owner left the workspace' where actor=old.id and status='queued';
 update public.crm_invitations set revoked_at=now() where invited_by=old.id and accepted_at is null and revoked_at is null;
 update public.crm_ai_settings set followup_enabled=false,followup_actor=null,updated_at=clock_timestamp() where organization_id=old.organization_id and followup_actor=old.id;
 return old;
end $$;
create or replace function public.crm_set_followups(enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare org uuid; settings public.crm_ai_settings;
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 if enabled is null then raise exception 'Invalid setting'; end if;
 org:=public.crm_organization_id();
 select * into settings from public.crm_ai_settings where organization_id=org for update;
 if not found then raise exception 'Save company knowledge first'; end if;
 if enabled and (not settings.drafts_enabled or length(trim(settings.knowledge))<20) then raise exception 'Enable drafts and save company knowledge first'; end if;
 if enabled and not exists(select 1 from public.crm_usage_periods where organization_id=org and starts_at<=now() and ends_at>now() and ai_limit>0) then raise exception 'An active AI allowance is required'; end if;
 update public.crm_ai_settings set followup_retry_after=null,followup_enabled=enabled,followup_actor=case when enabled then auth.uid() else null end,updated_at=clock_timestamp() where organization_id=org;
end $$;
commit;
