-- Automatic WhatsApp replies, made ready for real customers:
-- * an agent's own typed reply keeps the AI quiet in that chat for 30 minutes;
-- * at most 15 automatic replies per chat per 24 hours, then the chat is handed to a person;
-- * a photo, voice note or other non-text message no longer switches the AI off for good
--   (it just isn't answered automatically);
-- * a job is claimed only once it is 6 seconds old, so a customer who sends several quick
--   messages gets one reply to all of them;
-- * the AI sees the last 14 messages in both directions instead of 8.
begin;

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
 -- An agent is talking to this customer: stay out of the way.
 if exists(select 1 from public.crm_whatsapp_outbox o where o.conversation_id=chat.id and o.origin='manual'
   and o.created_at>now()-interval '30 minutes') then return new; end if;
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

-- Patch the deployed claim and start functions in place; fail if they aren't the expected version.
do $$
declare def text;
begin
 select pg_get_functiondef('public.crm_claim_auto_reply(uuid)'::regprocedure) into def;
 if position('j.status=''queued''' in def) = 0 then raise exception 'crm_claim_auto_reply is not the expected version'; end if;
 execute replace(def, 'j.status=''queued''', 'j.status=''queued'' and j.created_at<=now()-interval ''6 seconds''');

 select pg_get_functiondef('public.crm_start_auto_reply(uuid,uuid,text,bigint)'::regprocedure) into def;
 if position('limit 8) recent' in def) = 0 or position('''Assistant: ''' in def) = 0 then
  raise exception 'crm_start_auto_reply is not the expected version';
 end if;
 def := replace(def, 'limit 8) recent', 'limit 14) recent');
 def := replace(def, '''Assistant: ''', '''Business: ''');
 execute def;
end $$;

commit;
