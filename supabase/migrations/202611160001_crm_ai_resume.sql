-- "Resume AI now": an agent can end the 30-minute quiet period after a typed reply (or a
-- handover pause) straight away. Resuming also queues a reply to the customer's latest
-- message if it hasn't been answered yet, so the AI picks the conversation up immediately.
begin;

alter table public.crm_whatsapp_conversations add column ai_resumed_at timestamptz;

create or replace function public.crm_queue_auto_reply() returns trigger
language plpgsql security definer set search_path='' as $$
declare settings public.crm_ai_settings; chat public.crm_whatsapp_conversations;
begin
 -- Human/opt-out requests pause the conversation even when automation is currently disabled.
 if new.body ~* '(^|[^a-z])(stop|unsubscribe|opt out|human|speak to an agent)([^a-z]|$)' then
  update public.crm_whatsapp_conversations set ai_paused=true where id=new.conversation_id;
  update public.crm_auto_jobs set status='skipped',reason='Customer requested human attention' where conversation_id=new.conversation_id and status='queued';
  return new;
 end if;
 select * into settings from public.crm_ai_settings where organization_id=new.organization_id;
 select * into chat from public.crm_whatsapp_conversations where id=new.conversation_id;
 if not coalesce(settings.auto_enabled,false) or not settings.drafts_enabled or chat.ai_paused or settings.auto_actor is null then return new; end if;
 -- Anything newer supersedes a reply still waiting to be written.
 update public.crm_auto_jobs set status='skipped',reason='Newer customer message arrived' where conversation_id=chat.id and status='queued';
 if new.message_type<>'text' or new.sent_at<now()-interval '5 minutes' then return new; end if;
 -- An agent is talking to this customer: stay out of the way for 30 minutes.
 -- "Resume AI now" (ai_resumed_at) ends the quiet period early.
 if exists(select 1 from public.crm_whatsapp_outbox o where o.conversation_id=chat.id and o.origin='manual'
   and o.created_at>now()-interval '30 minutes'
   and (chat.ai_resumed_at is null or o.created_at>chat.ai_resumed_at)) then return new; end if;
 -- Runaway guard: after 15 automatic replies in a day, a person takes over.
 if (select count(*) from public.crm_whatsapp_outbox o where o.conversation_id=chat.id and o.origin='automatic'
   and o.created_at>now()-interval '24 hours') >= 15 then
  update public.crm_whatsapp_conversations set ai_paused=true where id=chat.id;
  return new;
 end if;
 insert into public.crm_auto_jobs(organization_id,conversation_id,source_message_id,actor,settings_at)
 values(new.organization_id,chat.id,new.id,settings.auto_actor,settings.updated_at) on conflict(source_message_id) do nothing;
 return new;
end $$;

-- For the lead's agent, an owner or an admin. Returns true when a reply was queued.
create function public.crm_resume_ai(conversation uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare chat public.crm_whatsapp_conversations; s public.crm_ai_settings; m public.crm_whatsapp_messages; queued boolean;
begin
 select * into chat from public.crm_whatsapp_conversations where id=conversation
  and organization_id=public.crm_organization_id() and public.crm_lead_access(lead_id) for update;
 if not found then raise exception 'Conversation unavailable'; end if;
 update public.crm_whatsapp_conversations set ai_paused=false, ai_resumed_at=now() where id=chat.id;
 select * into s from public.crm_ai_settings where organization_id=chat.organization_id;
 if not coalesce(s.auto_enabled,false) or not s.drafts_enabled or s.auto_actor is null
  or public.crm_whatsapp_opted_out(chat.id) then return false; end if;
 -- Answer the latest customer message only if it's text, inside WhatsApp's reply window,
 -- and nothing has been sent since.
 select * into m from public.crm_whatsapp_messages where conversation_id=chat.id order by sent_at desc, id desc limit 1;
 if not found or m.message_type<>'text' or m.sent_at<now()-interval '23 hours'
  or exists(select 1 from public.crm_whatsapp_outbox o where o.conversation_id=chat.id and o.created_at>m.sent_at
   and o.status in ('accepted','dispatching','unknown')) then return false; end if;
 insert into public.crm_auto_jobs(organization_id,conversation_id,source_message_id,actor,settings_at)
 values(chat.organization_id,chat.id,m.id,s.auto_actor,s.updated_at)
 on conflict(source_message_id) do update set status='queued', reason='', created_at=now(),
  claim_token=null, claimed_at=null, actor=excluded.actor, settings_at=excluded.settings_at
  where public.crm_auto_jobs.status='skipped'
 returning true into queued;
 return coalesce(queued, false);
end $$;
revoke all on function public.crm_resume_ai(uuid) from public, anon;
grant execute on function public.crm_resume_ai(uuid) to authenticated;

commit;
