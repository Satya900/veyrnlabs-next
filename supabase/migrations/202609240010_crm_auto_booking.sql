-- AI-driven WhatsApp booking, layered on the existing calendar and auto-reply infrastructure.
-- Tiered by design: the model only ever extracts a candidate date/time (ai-provider.ts); this
-- migration adds the deterministic, server-side gate that actually checks real availability and
-- books an event. A clean, unambiguous request against a free slot books automatically, exactly
-- like an opt-in automatic WhatsApp reply already does; anything else (ambiguous time, no
-- assigned agent, no connected calendar, no Pro Plus entitlement, or the slot being busy) falls
-- back to needs_human, with the extracted slot still recorded so an agent can book it in one tap.
begin;
alter table public.crm_ai_drafts add column proposed_visit_at timestamptz;
alter table public.crm_ai_drafts add column booking_status text not null default 'none'
 check(booking_status in ('none','attempted','booked','unavailable','failed'));
grant select(proposed_visit_at,booking_status) on public.crm_ai_drafts to authenticated;

-- Recreated with a trailing optional proposed_at so the reviewed (human-triggered) draft path
-- keeps calling this with its original five arguments unchanged.
drop function public.crm_finish_ai_draft(uuid,text,boolean,text,bigint);
create function public.crm_finish_ai_draft(job uuid, answer text, human_required boolean, explanation text, actual_cost bigint, proposed_at timestamptz default null)
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
 reason=left(coalesce(explanation,''),500),
 proposed_visit_at=proposed_at
 where id=job;
end $$;
revoke all on function public.crm_finish_ai_draft(uuid,text,boolean,text,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_finish_ai_draft(uuid,text,boolean,text,bigint,timestamptz) to service_role;

-- Worker-only: re-validates entitlement, lead ownership and calendar connection independently
-- of anything the model claimed, exactly like crm_calendar_connection_for_lead does for the
-- manual booking flow, and reserves this draft against a double booking attempt.
create function public.crm_prepare_auto_booking(job uuid, token uuid, start_iso timestamptz, end_iso timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.crm_auto_jobs; draft public.crm_ai_drafts; lead_row public.crm_leads; c public.crm_calendar_connections;
begin
 if start_iso is null or end_iso is null or start_iso<now()-interval '60 seconds'
 or end_iso-start_iso<interval '15 minutes' or end_iso-start_iso>interval '4 hours'
 then raise exception 'Invalid proposed visit time'; end if;
 select * into item from public.crm_auto_jobs where id=job and claim_token=token and status='processing' for update;
 if not found then raise exception 'Job unavailable'; end if;
 select * into draft from public.crm_ai_drafts where id=item.draft_id for update;
 if not found then raise exception 'Draft unavailable'; end if;
 if draft.booking_status<>'none' then return jsonb_build_object('run',false); end if;
 if not exists(select 1 from public.crm_subscriptions where organization_id=item.organization_id and plan='pro_plus' and active)
 then raise exception 'Automatic scheduling requires an active Pro Plus subscription'; end if;
 select l.* into lead_row from public.crm_whatsapp_conversations wc join public.crm_leads l on l.id=wc.lead_id
 where wc.id=item.conversation_id and wc.organization_id=item.organization_id and l.organization_id=item.organization_id;
 if not found then raise exception 'Lead unavailable'; end if;
 if lead_row.owner_id is null then raise exception 'Assign this lead to an agent before scheduling a site visit'; end if;
 select * into c from public.crm_calendar_connections where member_id=lead_row.owner_id and organization_id=item.organization_id;
 if not found then raise exception 'The assigned agent has not connected a calendar'; end if;
 update public.crm_ai_drafts set booking_status='attempted' where id=draft.id;
 return jsonb_build_object('run',true,'calendar_id',c.calendar_id,'refresh_token_encrypted',c.refresh_token_encrypted,
  'lead_id',lead_row.id,'lead_name',lead_row.name,'lead_company',lead_row.company,'lead_email',lead_row.email);
end $$;

create function public.crm_finish_auto_booking(job uuid, token uuid, outcome text, start_iso timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare item public.crm_auto_jobs; draft public.crm_ai_drafts; lead uuid;
begin
 if outcome not in ('booked','unavailable','failed') then raise exception 'Invalid outcome'; end if;
 select * into item from public.crm_auto_jobs where id=job and claim_token=token and status='processing' for update;
 if not found then raise exception 'Job unavailable'; end if;
 select * into draft from public.crm_ai_drafts where id=item.draft_id for update;
 if not found or draft.booking_status<>'attempted' then return; end if;
 update public.crm_ai_drafts set booking_status=outcome where id=draft.id;
 if outcome='booked' then
   select lead_id into lead from public.crm_whatsapp_conversations where id=item.conversation_id;
   -- organization_id defaults to crm_organization_id(), which resolves from the calling
   -- member's own row; under this service-role-only function there is no such member, so it
   -- must be set explicitly from the already-tenant-scoped auto_jobs row.
   insert into public.crm_activities(organization_id,lead_id,kind,body) values(item.organization_id,lead,'meeting',
    'Site visit scheduled for '||to_char(start_iso at time zone 'utc','DD Mon YYYY HH24:MI')||' UTC via connected calendar (booked automatically from WhatsApp).');
   update public.crm_leads set follow_up=start_iso where id=lead;
 end if;
end $$;
revoke all on function public.crm_prepare_auto_booking(uuid,uuid,timestamptz,timestamptz),public.crm_finish_auto_booking(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_prepare_auto_booking(uuid,uuid,timestamptz,timestamptz),public.crm_finish_auto_booking(uuid,uuid,text,timestamptz) to service_role;
commit;
