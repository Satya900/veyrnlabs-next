begin;
-- Separate outbox: provider acceptance is not a delivery receipt.
create table public.crm_whatsapp_outbox (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 conversation_id uuid not null,
 draft_id uuid not null unique,
 usage_event_id uuid not null,
 approved_by uuid not null references public.crm_members(id),
 body text not null check(length(trim(body)) between 1 and 3000),
 status text not null default 'dispatching' check(status in ('dispatching','accepted','rejected','unknown')),
 provider_message_id text,
 created_at timestamptz not null default now(),
 foreign key(organization_id,conversation_id) references public.crm_whatsapp_conversations(organization_id,id),
 foreign key(draft_id) references public.crm_ai_drafts(id),
 foreign key(organization_id,usage_event_id) references public.crm_usage_events(organization_id,id)
);
alter table public.crm_whatsapp_outbox enable row level security;
revoke all on public.crm_whatsapp_outbox from public,anon,authenticated;
grant all on public.crm_whatsapp_outbox to service_role;
grant select(id,organization_id,conversation_id,draft_id,body,status,created_at) on public.crm_whatsapp_outbox to authenticated;
create policy outbox_visible on public.crm_whatsapp_outbox for select to authenticated using(
 organization_id=public.crm_organization_id() and exists(select 1 from public.crm_whatsapp_conversations c where c.id=conversation_id)
);

create function public.crm_prepare_whatsapp_reply(actor uuid, draft uuid, approved_text text,
 scoped_org uuid, scoped_phone text, scoped_waba text, cost_paise bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.crm_members; d public.crm_ai_drafts; c public.crm_whatsapp_conversations;
 connection public.crm_whatsapp_connections; latest public.crm_whatsapp_messages;
 item public.crm_whatsapp_outbox; reservation uuid;
begin
 if approved_text is null or length(trim(approved_text)) not between 1 and 3000 then raise exception 'Reply must contain 1–3000 characters'; end if;
 select * into m from public.crm_members where id=actor;
 if not found then raise exception 'Sign in to continue'; end if;
 select * into d from public.crm_ai_drafts where id=draft and organization_id=m.organization_id;
 if not found then raise exception 'Draft unavailable'; end if;
 select * into c from public.crm_whatsapp_conversations where id=d.conversation_id for update;
 if not exists(select 1 from public.crm_leads where id=c.lead_id and organization_id=m.organization_id
 and (m.role in ('owner','admin') or owner_id=actor)) then raise exception 'Conversation unavailable'; end if;
 if c.organization_id is distinct from scoped_org then raise exception 'Sending is not configured for this workspace'; end if;
 select * into connection from public.crm_whatsapp_connections where id=c.connection_id;
 if not connection.active or connection.phone_number_id is distinct from scoped_phone or connection.waba_id is distinct from scoped_waba
 then raise exception 'Sending connection unavailable'; end if;
 select * into item from public.crm_whatsapp_outbox where draft_id=d.id;
 if found then return jsonb_build_object('id',item.id,'run',false,'status',item.status); end if;
 if d.status<>'review' then raise exception 'A current reviewable draft is required'; end if;
 select * into latest from public.crm_whatsapp_messages where conversation_id=c.id order by sent_at desc,id desc limit 1;
 if latest.id is distinct from d.source_message_id then raise exception 'A newer customer message arrived. Generate and review a new draft'; end if;
 -- Leave a minute of headroom for dispatch; Meta also enforces its own window.
 if latest.sent_at<now()-interval '23 hours 59 minutes' then raise exception 'Reply window closed. Ask the customer to message again'; end if;
 if exists(select 1 from public.crm_whatsapp_messages where conversation_id=c.id and body ~* '(^|[^a-z])(stop|unsubscribe|opt out)([^a-z]|$)')
 then raise exception 'Contact requested no messages. Sending is blocked pending consent review'; end if;
 reservation := public.crm_reserve_usage(c.organization_id,'wa-reply:'||d.id,'whatsapp',1,cost_paise);
 insert into public.crm_whatsapp_outbox(organization_id,conversation_id,draft_id,usage_event_id,approved_by,body)
 values(c.organization_id,c.id,d.id,reservation,actor,trim(approved_text)) returning * into item;
 return jsonb_build_object('id',item.id,'run',true,'recipient',c.sender,'body',item.body,'phone',connection.phone_number_id);
end $$;

create function public.crm_finish_whatsapp_reply(job uuid, outcome text, message_id text, cost_paise bigint)
returns void language plpgsql security definer set search_path='' as $$
declare item public.crm_whatsapp_outbox;
begin
 if outcome not in ('accepted','rejected','unknown') or outcome is null then raise exception 'Invalid outcome'; end if;
 if outcome='accepted' and (message_id is null or length(message_id) not between 1 and 500) then raise exception 'Missing provider receipt'; end if;
 select * into item from public.crm_whatsapp_outbox where id=job for update;
 if not found then raise exception 'Unknown send attempt'; end if;
 if item.status<>'dispatching' then
 if item.status=outcome and item.provider_message_id is not distinct from message_id then return; end if;
 raise exception 'Attempt already finalized'; end if;
 if outcome='accepted' then perform public.crm_finish_usage(item.organization_id,item.usage_event_id,cost_paise,false);
 elsif outcome='rejected' then perform public.crm_finish_usage(item.organization_id,item.usage_event_id,0,true);
 end if;
 update public.crm_whatsapp_outbox set status=outcome,provider_message_id=message_id where id=job;
end $$;
revoke all on function public.crm_prepare_whatsapp_reply(uuid,uuid,text,uuid,text,text,bigint),public.crm_finish_whatsapp_reply(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.crm_prepare_whatsapp_reply(uuid,uuid,text,uuid,text,text,bigint),public.crm_finish_whatsapp_reply(uuid,text,text,bigint) to service_role;
commit;
