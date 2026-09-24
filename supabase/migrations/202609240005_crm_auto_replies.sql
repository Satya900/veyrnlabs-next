begin;
alter table public.crm_ai_settings add column auto_enabled boolean not null default false;
alter table public.crm_ai_settings add column auto_actor uuid references public.crm_members(id);
alter table public.crm_whatsapp_outbox add column origin text not null default 'reviewed' check(origin in ('reviewed','automatic'));
grant select(origin) on public.crm_whatsapp_outbox to authenticated;
create table public.crm_auto_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 conversation_id uuid not null, source_message_id uuid not null unique,
 actor uuid not null references public.crm_members(id), settings_at timestamptz not null,
 status text not null default 'queued' check(status in ('queued','processing','complete','skipped','needs_human','failed')),
 claim_token uuid, claimed_at timestamptz, draft_id uuid references public.crm_ai_drafts(id),
 reason text not null default '', created_at timestamptz not null default now(),
 foreign key(organization_id,conversation_id) references public.crm_whatsapp_conversations(organization_id,id),
 foreign key(organization_id,source_message_id) references public.crm_whatsapp_messages(organization_id,id)
);
alter table public.crm_auto_jobs enable row level security;
revoke all on public.crm_auto_jobs from public,anon,authenticated;
grant all on public.crm_auto_jobs to service_role;
grant select(id,organization_id,conversation_id,status,reason,created_at) on public.crm_auto_jobs to authenticated;
create policy auto_jobs_admin on public.crm_auto_jobs for select to authenticated using(organization_id=public.crm_organization_id() and public.crm_role() in ('owner','admin'));
create index crm_auto_queue on public.crm_auto_jobs(organization_id,status,created_at);

create function public.crm_set_auto_replies(enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare org uuid; settings public.crm_ai_settings;
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 if enabled is null then raise exception 'Invalid setting'; end if;
 org:=public.crm_organization_id();
 select * into settings from public.crm_ai_settings where organization_id=org for update;
 if not found then raise exception 'Save company knowledge first'; end if;
 if enabled and (not settings.drafts_enabled or length(trim(settings.knowledge))<20) then raise exception 'Enable drafts and save company knowledge first'; end if;
 if enabled and not exists(select 1 from public.crm_usage_periods where organization_id=org and starts_at<=now() and ends_at>now() and whatsapp_limit>0 and ai_limit>0) then raise exception 'An active AI and messaging allowance is required'; end if;
 update public.crm_ai_settings set auto_enabled=enabled,auto_actor=case when enabled then auth.uid() else null end,updated_at=clock_timestamp() where organization_id=org;
 update public.crm_auto_jobs set status='skipped',reason='Automatic reply settings changed' where organization_id=org and status='queued';
end $$;

create function public.crm_queue_auto_reply() returns trigger language plpgsql security definer set search_path='' as $$
declare settings public.crm_ai_settings; chat public.crm_whatsapp_conversations;
begin
 -- Human/opt-out requests pause the conversation even when automation is currently disabled.
 if new.body ~* '(^|[^a-z])(stop|unsubscribe|opt out|human|speak to an agent)([^a-z]|$)' then
 update public.crm_whatsapp_conversations set ai_paused=true where id=new.conversation_id;
 update public.crm_auto_jobs set status='skipped',reason='Customer requested human attention' where conversation_id=new.conversation_id and status='queued';
 return new; end if;
 select * into settings from public.crm_ai_settings where organization_id=new.organization_id;
 select * into chat from public.crm_whatsapp_conversations where id=new.conversation_id;
 if not coalesce(settings.auto_enabled,false) or not settings.drafts_enabled or chat.ai_paused or settings.auto_actor is null then return new; end if;
 if new.message_type<>'text' then
 update public.crm_whatsapp_conversations set ai_paused=true where id=chat.id;
 return new; end if;
 if new.sent_at<now()-interval '5 minutes' then return new; end if;
 update public.crm_auto_jobs set status='skipped',reason='Newer customer message arrived' where conversation_id=chat.id and status='queued';
 insert into public.crm_auto_jobs(organization_id,conversation_id,source_message_id,actor,settings_at)
 values(new.organization_id,chat.id,new.id,settings.auto_actor,settings.updated_at) on conflict(source_message_id) do nothing;
 return new;
end $$;
create trigger crm_incoming_auto_reply after insert on public.crm_whatsapp_messages for each row execute function public.crm_queue_auto_reply();

create function public.crm_claim_auto_reply(org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.crm_auto_jobs;
begin
 -- Abandoned work is never automatically retried: the provider may have completed it.
 with abandoned as (update public.crm_auto_jobs set status='failed',reason='Worker interrupted; reconcile before resuming' where organization_id=org and status='processing' and claimed_at<now()-interval '5 minutes' returning conversation_id)
 update public.crm_whatsapp_conversations set ai_paused=true where organization_id=org and id in (select conversation_id from abandoned);
 select * into item from public.crm_auto_jobs j where j.organization_id=org and j.status='queued'
 and not exists(select 1 from public.crm_auto_jobs busy where busy.conversation_id=j.conversation_id and busy.status='processing')
 order by j.created_at limit 1 for update skip locked;
 if not found then return null; end if;
 update public.crm_auto_jobs set status='processing',claim_token=gen_random_uuid(),claimed_at=now() where id=item.id returning * into item;
 return jsonb_build_object('id',item.id,'token',item.claim_token);
end $$;

create function public.crm_start_auto_reply(job uuid, token uuid, model text, maximum_cost bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.crm_auto_jobs; settings public.crm_ai_settings; latest uuid; result jsonb; context jsonb;
begin
 select * into item from public.crm_auto_jobs where id=job and claim_token=token and status='processing' for update;
 if not found then raise exception 'Job unavailable'; end if;
 if item.created_at<now()-interval '5 minutes' then raise exception 'Job expired; review this conversation'; end if;
 select * into settings from public.crm_ai_settings where organization_id=item.organization_id;
 if not settings.auto_enabled or settings.updated_at<>item.settings_at or settings.auto_actor is distinct from item.actor
 or not exists(select 1 from public.crm_members where id=item.actor and organization_id=item.organization_id and role in ('owner','admin')) then raise exception 'Automatic replies disabled or settings changed'; end if;
 select id into latest from public.crm_whatsapp_messages where conversation_id=item.conversation_id order by sent_at desc,id desc limit 1;
 if latest is distinct from item.source_message_id then raise exception 'Newer message arrived'; end if;
 result:=public.crm_start_ai_draft(item.actor,item.conversation_id,model,maximum_cost);
 if not (result->>'run')::boolean then raise exception 'Message already handled; manual review required'; end if;
 update public.crm_auto_jobs set draft_id=(result->>'id')::uuid where id=job;
 -- Include actual accepted outgoing replies so the model does not repeat introductory questions.
 select jsonb_agg(jsonb_build_object('text',text) order by happened,id) into context from
 (select * from (
 select id,sent_at happened,left('Customer: '||body,1500) text from public.crm_whatsapp_messages where conversation_id=item.conversation_id and message_type='text'
 union all select id,created_at,left('Assistant: '||body,1500) from public.crm_whatsapp_outbox where conversation_id=item.conversation_id and status='accepted'
 ) history order by happened desc,id desc limit 8) recent;
 return result || jsonb_build_object('history',context);
end $$;

create function public.crm_prepare_auto_reply(job uuid, token uuid, scoped_org uuid, scoped_phone text, scoped_waba text, cost_paise bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.crm_auto_jobs; settings public.crm_ai_settings; draft public.crm_ai_drafts; result jsonb;
begin
 select * into item from public.crm_auto_jobs where id=job and claim_token=token and status='processing' for update;
 if not found then raise exception 'Job unavailable'; end if;
 perform 1 from public.crm_whatsapp_conversations where id=item.conversation_id and not ai_paused for update;
 if not found then raise exception 'Human takeover is active'; end if;
 select * into settings from public.crm_ai_settings where organization_id=item.organization_id for update;
 if not settings.auto_enabled or not settings.drafts_enabled or settings.updated_at<>item.settings_at or settings.auto_actor is distinct from item.actor
 or not exists(select 1 from public.crm_members where id=item.actor and organization_id=item.organization_id and role in ('owner','admin')) then raise exception 'Automatic replies disabled or settings changed'; end if;
 select * into draft from public.crm_ai_drafts where id=item.draft_id and source_message_id=item.source_message_id and organization_id=item.organization_id;
 if not found or draft.status<>'review' then raise exception 'Reply requires human review'; end if;
 result:=public.crm_prepare_whatsapp_reply(item.actor,draft.id,draft.reply,scoped_org,scoped_phone,scoped_waba,cost_paise);
 if (result->>'run')::boolean then update public.crm_whatsapp_outbox set origin='automatic' where id=(result->>'id')::uuid; end if;
 return result;
end $$;

create function public.crm_end_auto_reply(job uuid, token uuid, outcome text, explanation text) returns void language plpgsql security definer set search_path='' as $$
declare item public.crm_auto_jobs;
begin
 if outcome not in ('complete','skipped','needs_human','failed') then raise exception 'Invalid outcome'; end if;
 update public.crm_auto_jobs set status=outcome,reason=left(coalesce(explanation,''),300) where id=job and claim_token=token and status='processing' returning * into item;
 if found and outcome in ('needs_human','failed') then update public.crm_whatsapp_conversations set ai_paused=true where id=item.conversation_id; end if;
end $$;
revoke all on function public.crm_set_auto_replies(boolean),public.crm_queue_auto_reply(),public.crm_claim_auto_reply(uuid),public.crm_start_auto_reply(uuid,uuid,text,bigint),public.crm_prepare_auto_reply(uuid,uuid,uuid,text,text,bigint),public.crm_end_auto_reply(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_set_auto_replies(boolean) to authenticated;
grant execute on function public.crm_claim_auto_reply(uuid),public.crm_start_auto_reply(uuid,uuid,text,bigint),public.crm_prepare_auto_reply(uuid,uuid,uuid,text,text,bigint),public.crm_end_auto_reply(uuid,uuid,text,text) to service_role;
create or replace function public.crm_save_ai_settings(company_knowledge text, enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 insert into public.crm_ai_settings(organization_id,knowledge,drafts_enabled) values(public.crm_organization_id(),company_knowledge,enabled)
 on conflict(organization_id) do update set knowledge=excluded.knowledge,drafts_enabled=excluded.drafts_enabled,
 auto_enabled=public.crm_ai_settings.auto_enabled and excluded.drafts_enabled,
 auto_actor=case when excluded.drafts_enabled then public.crm_ai_settings.auto_actor else null end,
 updated_at=clock_timestamp();
end $$;
commit;
