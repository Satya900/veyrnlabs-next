-- Plans: AI auto-replies are a Pro Plus feature. Pro workspaces get a 14-day free trial that
-- starts when they first switch automatic replies on; Pro workspaces already using them start
-- their 14 days now. After the trial no new automatic replies are queued (the setting stays
-- saved and works again after upgrading). AI site-visit booking was already Pro Plus only.
begin;

alter table public.crm_ai_settings add column auto_trial_started_at timestamptz;
update public.crm_ai_settings a set auto_trial_started_at = now()
 where a.auto_enabled and not exists(select 1 from public.crm_subscriptions s
  where s.organization_id = a.organization_id and s.plan = 'pro_plus' and s.active);

-- What a workspace's plan allows for automatic replies. Server only.
create function public.crm_auto_reply_access(org uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'plan', s.plan,
  'active', coalesce(s.active, false),
  'trial_started_at', a.auto_trial_started_at,
  'trial_ends_at', a.auto_trial_started_at + interval '14 days',
  'can_start_trial', coalesce(s.active and s.plan = 'pro' and a.auto_trial_started_at is null, false),
  'allowed', coalesce(s.active and (s.plan = 'pro_plus'
   or (s.plan = 'pro' and a.auto_trial_started_at > now() - interval '14 days')), false))
 from (select org as id) o
 left join public.crm_subscriptions s on s.organization_id = o.id
 left join public.crm_ai_settings a on a.organization_id = o.id
$$;
revoke all on function public.crm_auto_reply_access(uuid) from public, anon, authenticated;
grant execute on function public.crm_auto_reply_access(uuid) to service_role;

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

create or replace function public.crm_set_auto_replies(enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid; settings public.crm_ai_settings; access jsonb;
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 if enabled is null then raise exception 'Invalid setting'; end if;
 org:=public.crm_organization_id();
 select * into settings from public.crm_ai_settings where organization_id=org for update;
 if not found then raise exception 'Save company knowledge first'; end if;
 if enabled and (not settings.drafts_enabled or length(trim(settings.knowledge))<20) then raise exception 'Enable drafts and save company knowledge first'; end if;
 if enabled and not exists(select 1 from public.crm_usage_periods where organization_id=org and starts_at<=now() and ends_at>now() and whatsapp_limit>0 and ai_limit>0) then raise exception 'An active AI and messaging allowance is required'; end if;
 if enabled then
  access := public.crm_auto_reply_access(org);
  if not (access->>'allowed')::boolean and not (access->>'can_start_trial')::boolean then
   raise exception 'AI auto-replies are part of Pro Plus. Upgrade to keep the AI replying to customers.';
  end if;
 end if;
 update public.crm_ai_settings set auto_enabled=enabled,auto_actor=case when enabled then public.crm_member_id() else null end,
  auto_trial_started_at=case when enabled and (access->>'can_start_trial')::boolean then now() else auto_trial_started_at end,
  updated_at=clock_timestamp() where organization_id=org;
 update public.crm_auto_jobs set status='skipped',reason='Automatic reply settings changed' where organization_id=org and status='queued';
end $$;

do $$
declare def text;
begin
 select pg_get_functiondef('public.crm_resume_ai(uuid)'::regprocedure) into def;
 if position('or public.crm_whatsapp_opted_out(chat.id) then return false; end if;' in def) = 0 then
  raise exception 'crm_resume_ai is not the expected version';
 end if;
 execute replace(def, 'or public.crm_whatsapp_opted_out(chat.id) then return false; end if;',
  'or public.crm_whatsapp_opted_out(chat.id)
  or not (public.crm_auto_reply_access(chat.organization_id)->>''allowed'')::boolean then return false; end if;');
end $$;

commit;
