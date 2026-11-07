-- AI lead insights: from a lead's WhatsApp chat, a short summary, a hot/warm/cold score with
-- a reason, the details the customer shared (budget, location, property type, timeline,
-- purpose) and up to three suggested replies. One row per lead, replaced on each refresh.
-- Generated on request by the server (service role), counted as one AI action per refresh.
begin;

create table public.crm_lead_insights (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 lead_id uuid not null,
 conversation_id uuid,
 score text not null check(score in ('hot','warm','cold')),
 score_reason text not null default '' check(length(score_reason)<=300),
 summary text not null default '' check(length(summary)<=600),
 details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object' and length(details::text)<=2000),
 suggestions jsonb not null default '[]'::jsonb
  check(jsonb_typeof(suggestions)='array' and jsonb_array_length(suggestions)<=3 and length(suggestions::text)<=2400),
 -- The conversation's last message time this insight was generated from; newer means stale.
 based_on timestamptz,
 updated_at timestamptz not null default now(),
 foreign key(organization_id,lead_id) references public.crm_leads(organization_id,id) on delete cascade,
 unique(lead_id)
);
alter table public.crm_lead_insights enable row level security;
revoke all on public.crm_lead_insights from public, anon, authenticated;
grant select on public.crm_lead_insights to authenticated;
grant all on public.crm_lead_insights to service_role;
-- Whoever can see the lead can see its insight; only the server writes them.
create policy lead_insights_read on public.crm_lead_insights for select to authenticated
 using (public.crm_lead_view(lead_id));

-- What the AI reads for one conversation: the lead, the company knowledge and the last 20
-- messages in both directions (customer messages and what the business sent). The caller
-- has already checked the actor can see this conversation; this checks the actor's seat.
create function public.crm_lead_insight_context(actor uuid, conversation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.crm_whatsapp_conversations; l public.crm_leads; m public.crm_members;
begin
 select * into c from public.crm_whatsapp_conversations where id=conversation;
 if not found then raise exception 'Conversation unavailable'; end if;
 select * into m from public.crm_members where id=actor and organization_id=c.organization_id;
 if not found or not public.crm_member_seat_active(actor) then raise exception 'Seat inactive'; end if;
 select * into l from public.crm_leads where id=c.lead_id and organization_id=c.organization_id;
 return jsonb_build_object(
  'organization_id', c.organization_id,
  'lead_id', l.id,
  'based_on', c.last_message_at,
  'lead', jsonb_build_object('name', l.name, 'service', l.service, 'value', l.value, 'notes', left(coalesce(l.notes,''), 1500)),
  'business', (select name from public.crm_organizations where id=c.organization_id),
  'knowledge', coalesce((select left(knowledge, 6000) from public.crm_ai_settings where organization_id=c.organization_id), ''),
  'messages', coalesce((
   select jsonb_agg(jsonb_build_object('from', x.side, 'at', x.at, 'text', x.body) order by x.at)
   from (
    select * from (
     select 'customer' side, msg.sent_at at, left(msg.body, 1000) body from public.crm_whatsapp_messages msg
      where msg.conversation_id=c.id and msg.body<>''
     union all
     select 'business', o.created_at, left(o.body, 1000) from public.crm_whatsapp_outbox o
      where o.conversation_id=c.id and o.status in ('accepted','unknown','dispatching')
    ) everything order by at desc limit 20
   ) x
  ), '[]'::jsonb)
 );
end $$;

-- Saves an insight and fills lead fields that are still empty: what they're looking for
-- (service) and the budget (value). Never overwrites anything the agent typed.
create function public.crm_save_lead_insight(org uuid, lead uuid, conversation uuid, generated_from timestamptz,
 new_score text, new_reason text, new_summary text, new_details jsonb, new_suggestions jsonb, looking_for text, budget_inr bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.crm_lead_insights(organization_id,lead_id,conversation_id,score,score_reason,summary,details,suggestions,based_on,updated_at)
 values(org,lead,conversation,new_score,left(new_reason,300),left(new_summary,600),new_details,new_suggestions,generated_from,now())
 on conflict(lead_id) do update set conversation_id=excluded.conversation_id, score=excluded.score,
  score_reason=excluded.score_reason, summary=excluded.summary, details=excluded.details,
  suggestions=excluded.suggestions, based_on=excluded.based_on, updated_at=now()
 where public.crm_lead_insights.organization_id=org;
 -- One update, so the lead's activity shows a single "details updated" entry.
 update public.crm_leads l set
  service = case when coalesce(trim(l.service),'')='' and coalesce(trim(looking_for),'')<>'' then left(trim(looking_for),200) else l.service end,
  value = case when coalesce(l.value,0)=0 and budget_inr between 10000 and 10000000000 then budget_inr else l.value end
 where l.id=lead and l.organization_id=org
  and ((coalesce(trim(l.service),'')='' and coalesce(trim(looking_for),'')<>'')
   or (coalesce(l.value,0)=0 and budget_inr between 10000 and 10000000000));
end $$;

revoke all on function public.crm_lead_insight_context(uuid,uuid),
 public.crm_save_lead_insight(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,jsonb,text,bigint) from public, anon, authenticated;
grant execute on function public.crm_lead_insight_context(uuid,uuid),
 public.crm_save_lead_insight(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,jsonb,text,bigint) to service_role;

commit;
