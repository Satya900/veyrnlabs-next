begin;
create table public.crm_ai_settings (
 organization_id uuid primary key references public.crm_organizations(id),
 knowledge text not null default '' check(length(knowledge)<=12000),
 drafts_enabled boolean not null default false,
 updated_at timestamptz not null default now(),
 check(not drafts_enabled or length(trim(knowledge))>=20)
);
alter table public.crm_whatsapp_conversations add column ai_paused boolean not null default false;
alter table public.crm_whatsapp_messages add constraint crm_whatsapp_message_org_id unique(organization_id,id);
alter table public.crm_usage_events add constraint crm_usage_event_org_id unique(organization_id,id);
create table public.crm_ai_drafts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 conversation_id uuid not null,
 source_message_id uuid not null,
 usage_event_id uuid not null,
 status text not null default 'generating' check(status in ('generating','review','needs_human','failed','superseded')),
 reply text not null default '' check(length(reply)<=3000),
 reason text not null default '' check(length(reason)<=500),
 model text not null check(length(model) between 1 and 100),
 created_at timestamptz not null default now(),
 foreign key(organization_id,conversation_id) references public.crm_whatsapp_conversations(organization_id,id),
 foreign key(organization_id,source_message_id) references public.crm_whatsapp_messages(organization_id,id),
 foreign key(organization_id,usage_event_id) references public.crm_usage_events(organization_id,id),
 unique(source_message_id)
);
alter table public.crm_ai_settings enable row level security;
alter table public.crm_ai_drafts enable row level security;
revoke all on public.crm_ai_settings,public.crm_ai_drafts from public,anon,authenticated;
grant select on public.crm_ai_settings to authenticated;
grant select(id,organization_id,conversation_id,source_message_id,status,reply,reason,created_at) on public.crm_ai_drafts to authenticated;
grant all on public.crm_ai_settings,public.crm_ai_drafts to service_role;
create policy ai_settings_admin on public.crm_ai_settings for select to authenticated
 using(organization_id=public.crm_organization_id() and public.crm_role() in ('owner','admin'));
create policy ai_drafts_access on public.crm_ai_drafts for select to authenticated using(
 organization_id=public.crm_organization_id() and exists(select 1 from public.crm_whatsapp_conversations c where c.id=conversation_id)
);

create function public.crm_save_ai_settings(company_knowledge text, enabled boolean) returns void
 language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 insert into public.crm_ai_settings(organization_id,knowledge,drafts_enabled)
 values(public.crm_organization_id(),company_knowledge,enabled)
 on conflict(organization_id) do update set knowledge=excluded.knowledge,drafts_enabled=excluded.drafts_enabled,updated_at=now();
end $$;
create function public.crm_set_ai_handover(conversation uuid, paused boolean) returns void
 language plpgsql security definer set search_path='' as $$
begin
 if paused is null then raise exception 'Invalid handover'; end if;
 update public.crm_whatsapp_conversations set ai_paused=paused where id=conversation
 and organization_id=public.crm_organization_id() and public.crm_lead_access(lead_id);
 if not found then raise exception 'Conversation unavailable'; end if;
end $$;

-- Only the authenticated server supplies actor and the cost estimate; customers cannot reserve arbitrary cheap jobs.
create function public.crm_start_ai_draft(actor uuid, conversation uuid, selected_model text, maximum_cost bigint)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.crm_whatsapp_conversations; s public.crm_ai_settings; m public.crm_whatsapp_messages;
 member public.crm_members; draft public.crm_ai_drafts; reservation uuid; history jsonb;
begin
 select * into member from public.crm_members where id=actor;
 if not found then raise exception 'Sign in to continue'; end if;
 select * into c from public.crm_whatsapp_conversations where id=conversation and organization_id=member.organization_id for update;
 if not found or not exists(select 1 from public.crm_leads where id=c.lead_id and organization_id=member.organization_id
   and (member.role in ('owner','admin') or owner_id=actor)) then raise exception 'Conversation unavailable'; end if;
 if c.ai_paused then raise exception 'AI is paused for human handover'; end if;
 select * into s from public.crm_ai_settings where organization_id=c.organization_id;
 if not found or not s.drafts_enabled then raise exception 'Enable AI drafts and add company knowledge in Settings'; end if;
 if not exists(select 1 from public.crm_whatsapp_connections where id=c.connection_id and active) then raise exception 'WhatsApp connection paused'; end if;
 select * into m from public.crm_whatsapp_messages where conversation_id=c.id order by sent_at desc,id desc limit 1;
 if not found or m.message_type<>'text' then raise exception 'A text message is required'; end if;
 if m.sent_at<now()-interval '24 hours' then raise exception 'Latest customer message is outside the reply window'; end if;
 if m.body ~* '(^|[^a-z])(stop|unsubscribe|opt out|human|speak to an agent)([^a-z]|$)' then
   raise exception 'Customer requires human attention; take over this conversation';
 end if;
 select * into draft from public.crm_ai_drafts where source_message_id=m.id;
 if found then return jsonb_build_object('id',draft.id,'run',false); end if;
 reservation := public.crm_reserve_usage(c.organization_id,'ai-draft:'||m.id,'ai',1,maximum_cost);
 insert into public.crm_ai_drafts(organization_id,conversation_id,source_message_id,usage_event_id,model)
 values(c.organization_id,c.id,m.id,reservation,selected_model) returning * into draft;
 select jsonb_agg(jsonb_build_object('text',left(body,1500)) order by sent_at,id) into history
 from (select body,sent_at,id from public.crm_whatsapp_messages where conversation_id=c.id and message_type='text'
 order by sent_at desc,id desc limit 8) recent;
 return jsonb_build_object('id',draft.id,'run',true,'knowledge',s.knowledge,'history',history);
end $$;

create function public.crm_finish_ai_draft(job uuid, answer text, human_required boolean, explanation text, actual_cost bigint)
 returns void language plpgsql security definer set search_path='' as $$
declare d public.crm_ai_drafts; c public.crm_whatsapp_conversations; latest uuid; enabled boolean;
begin
 select * into d from public.crm_ai_drafts where id=job;
 if not found then raise exception 'Unknown draft'; end if;
 select * into c from public.crm_whatsapp_conversations where id=d.conversation_id for update;
 select * into d from public.crm_ai_drafts where id=job for update;
 if d.status<>'generating' then return; end if;
 if actual_cost is not null then perform public.crm_finish_usage(d.organization_id,d.usage_event_id,actual_cost,false); end if;
 select id into latest from public.crm_whatsapp_messages where conversation_id=c.id order by sent_at desc,id desc limit 1;
 select drafts_enabled into enabled from public.crm_ai_settings where organization_id=c.organization_id;
 update public.crm_ai_drafts set
 status=case when actual_cost is null then 'failed'
  when latest<>d.source_message_id or c.ai_paused or not coalesce(enabled,false) then 'superseded'
  when human_required or coalesce(answer,'')='' then 'needs_human' else 'review' end,
 reply=case when actual_cost is not null and latest=d.source_message_id and not c.ai_paused and enabled then coalesce(answer,'') else '' end,
 reason=left(coalesce(explanation,''),500) where id=job;
end $$;
revoke all on function public.crm_save_ai_settings(text,boolean),public.crm_set_ai_handover(uuid,boolean),
 public.crm_start_ai_draft(uuid,uuid,text,bigint),public.crm_finish_ai_draft(uuid,text,boolean,text,bigint) from public,anon,authenticated;
grant execute on function public.crm_save_ai_settings(text,boolean),public.crm_set_ai_handover(uuid,boolean) to authenticated;
grant execute on function public.crm_start_ai_draft(uuid,uuid,text,bigint),public.crm_finish_ai_draft(uuid,text,boolean,text,bigint) to service_role;
commit;
