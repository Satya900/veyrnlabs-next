-- AI off per contact. For a number used for both personal and business chats: a chat with
-- AI off gets no automatic replies, insights, suggestions or drafts, so the AI never reads it
-- and it never uses the AI allowance. A workspace setting decides whether chats from unknown
-- numbers start with AI on (the default) or off; leads added by a person keep AI on.
begin;

alter table public.crm_whatsapp_conversations add column ai_disabled boolean not null default false;
alter table public.crm_ai_settings add column ai_new_chats boolean not null default true;

create function public.crm_new_chat_ai() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce((select ai_new_chats from public.crm_ai_settings where organization_id=new.organization_id), true)
  and exists(select 1 from public.crm_leads where id=new.lead_id and source='WhatsApp') then
  new.ai_disabled := true;
 end if;
 return new;
end $$;
create trigger crm_new_chat_ai before insert on public.crm_whatsapp_conversations
 for each row execute function public.crm_new_chat_ai();
revoke all on function public.crm_new_chat_ai() from public, anon, authenticated;

-- For the lead's agent, an owner or an admin. Turning AI off also drops any reply waiting to be written.
create function public.crm_set_chat_ai(conversation uuid, enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if enabled is null then raise exception 'Invalid setting'; end if;
 update public.crm_whatsapp_conversations set ai_disabled = not enabled
  where id=conversation and organization_id=public.crm_organization_id() and public.crm_lead_access(lead_id);
 if not found then raise exception 'Conversation unavailable'; end if;
 if not enabled then
  update public.crm_auto_jobs set status='skipped', reason='AI turned off for this contact'
   where conversation_id=conversation and status='queued';
 end if;
end $$;

create function public.crm_set_ai_new_chats(enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 if enabled is null then raise exception 'Invalid setting'; end if;
 insert into public.crm_ai_settings(organization_id, ai_new_chats) values(public.crm_organization_id(), enabled)
 on conflict(organization_id) do update set ai_new_chats = excluded.ai_new_chats;
end $$;
revoke all on function public.crm_set_chat_ai(uuid,boolean), public.crm_set_ai_new_chats(boolean) from public, anon;
grant execute on function public.crm_set_chat_ai(uuid,boolean), public.crm_set_ai_new_chats(boolean) to authenticated;

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
 if not coalesce(settings.auto_enabled,false) or not settings.drafts_enabled or chat.ai_paused or chat.ai_disabled or settings.auto_actor is null then return new; end if;
 -- Pro Plus, or a Pro workspace inside its 14-day trial.
 if not (public.crm_auto_reply_access(new.organization_id)->>'allowed')::boolean then return new; end if;
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

-- Every other AI entry point refuses chats with AI off. Patched in place; fails if a
-- definition isn't the expected version.
do $$
declare def text;
 guard constant text := 'if not found then raise exception ''Conversation unavailable''; end if;';
begin
 select pg_get_functiondef('public.crm_lead_insight_context(uuid,uuid)'::regprocedure) into def;
 if position(guard in def) = 0 then raise exception 'crm_lead_insight_context is not the expected version'; end if;
 execute replace(def, guard, guard || ' if c.ai_disabled then raise exception ''AI is off for this contact''; end if;');

 select pg_get_functiondef('public.crm_resume_ai(uuid)'::regprocedure) into def;
 if position(guard in def) = 0 then raise exception 'crm_resume_ai is not the expected version'; end if;
 execute replace(def, guard, guard || ' if chat.ai_disabled then raise exception ''AI is off for this contact''; end if;');

 select pg_get_functiondef('public.crm_start_ai_draft_before_seats(uuid,uuid,text,bigint)'::regprocedure) into def;
 if position('if c.ai_paused then raise exception ''AI is paused for human handover''; end if;' in def) = 0 then
  raise exception 'crm_start_ai_draft_before_seats is not the expected version';
 end if;
 execute replace(def, 'if c.ai_paused then raise exception ''AI is paused for human handover''; end if;',
  'if c.ai_paused then raise exception ''AI is paused for human handover''; end if;
 if c.ai_disabled then raise exception ''AI is off for this contact''; end if;');
end $$;

commit;
