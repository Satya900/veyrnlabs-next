begin;
-- A trusted operator maps Meta assets after checking business ownership.
-- Receive-only integration: no access tokens or sending credentials are stored yet.
create table public.crm_whatsapp_connections (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null unique references public.crm_organizations(id),
 waba_id text not null check(waba_id ~ '^[0-9]{1,30}$'),
 phone_number_id text not null unique check(phone_number_id ~ '^[0-9]{1,30}$'),
 display_phone text not null check(length(display_phone) between 1 and 50),
 active boolean not null default false,
 created_at timestamptz not null default now(),
 unique(organization_id,id)
);
create table public.crm_whatsapp_conversations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 connection_id uuid not null,
 lead_id uuid not null,
 sender text not null check(sender ~ '^[0-9]{5,20}$'),
 contact_name text not null default '' check(length(contact_name)<=200),
 last_message_at timestamptz not null,
 created_at timestamptz not null default now(),
 foreign key(organization_id,connection_id) references public.crm_whatsapp_connections(organization_id,id),
 foreign key(organization_id,lead_id) references public.crm_leads(organization_id,id),
 unique(connection_id,sender), unique(organization_id,id)
);
create table public.crm_whatsapp_messages (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 conversation_id uuid not null,
 message_id text not null check(length(message_id) between 1 and 300),
 message_type text not null check(message_type ~ '^[a-z_]{1,40}$'),
 body text not null default '' check(length(body)<=4096),
 sent_at timestamptz not null,
 received_at timestamptz not null default now(),
 foreign key(organization_id,conversation_id) references public.crm_whatsapp_conversations(organization_id,id),
 unique(organization_id,message_id)
);
create index crm_whatsapp_conversation_recent on public.crm_whatsapp_conversations(organization_id,last_message_at desc,id);
create index crm_whatsapp_message_history on public.crm_whatsapp_messages(conversation_id,sent_at desc,id);
alter table public.crm_whatsapp_connections enable row level security;
alter table public.crm_whatsapp_conversations enable row level security;
alter table public.crm_whatsapp_messages enable row level security;
revoke all on public.crm_whatsapp_connections,public.crm_whatsapp_conversations,public.crm_whatsapp_messages from public,anon,authenticated;
grant select on public.crm_whatsapp_connections,public.crm_whatsapp_conversations,public.crm_whatsapp_messages to authenticated;
grant all on public.crm_whatsapp_connections,public.crm_whatsapp_conversations,public.crm_whatsapp_messages to service_role;
create policy whatsapp_connection_admin on public.crm_whatsapp_connections for select to authenticated
 using(organization_id=public.crm_organization_id() and public.crm_role() in ('owner','admin'));
create policy whatsapp_conversation_access on public.crm_whatsapp_conversations for select to authenticated
 using(organization_id=public.crm_organization_id() and public.crm_lead_access(lead_id));
create policy whatsapp_message_access on public.crm_whatsapp_messages for select to authenticated
 using(organization_id=public.crm_organization_id() and exists(
   select 1 from public.crm_whatsapp_conversations c where c.id=conversation_id and c.organization_id=crm_whatsapp_messages.organization_id
 ));

create function public.crm_receive_whatsapp(events jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare item jsonb; connection public.crm_whatsapp_connections; conversation public.crm_whatsapp_conversations;
 lead uuid; stage uuid; stamp timestamptz; inserted integer:=0; ignored integer:=0;
begin
 if events is null or jsonb_typeof(events)<>'array' or jsonb_array_length(events)>500 then raise exception 'Invalid event batch'; end if;
 -- Sort connection locks to avoid deadlocks between multi-number batches.
 for item in select value from jsonb_array_elements(events) order by value->>'phone_number_id',value->>'message_id' loop
   select * into connection from public.crm_whatsapp_connections
    where phone_number_id=item->>'phone_number_id' and waba_id=item->>'waba_id' and active for update;
   if not found then ignored:=ignored+1; continue; end if;
   if exists(select 1 from public.crm_whatsapp_messages where organization_id=connection.organization_id and message_id=item->>'message_id') then continue; end if;
   stamp := (item->>'sent_at')::timestamptz;
   if stamp is null or stamp > now()+interval '5 minutes' or stamp < '2000-01-01'::timestamptz then raise exception 'Invalid message time'; end if;
   select * into conversation from public.crm_whatsapp_conversations where connection_id=connection.id and sender=item->>'sender';
   if not found then
     select id into stage from public.crm_stages where organization_id=connection.organization_id and kind='open' order by position,id limit 1;
     if stage is null then raise exception 'Configure an open lead stage before receiving messages'; end if;
     insert into public.crm_leads(organization_id,name,phone,source,stage_id)
      values(connection.organization_id,coalesce(nullif(item->>'contact_name',''),item->>'sender'),item->>'sender','WhatsApp',stage) returning id into lead;
     insert into public.crm_whatsapp_conversations(organization_id,connection_id,lead_id,sender,contact_name,last_message_at)
      values(connection.organization_id,connection.id,lead,item->>'sender',coalesce(item->>'contact_name',''),stamp) returning * into conversation;
   end if;
   insert into public.crm_whatsapp_messages(organization_id,conversation_id,message_id,message_type,body,sent_at)
    values(connection.organization_id,conversation.id,item->>'message_id',item->>'message_type',coalesce(item->>'body',''),stamp);
   update public.crm_whatsapp_conversations set last_message_at=greatest(last_message_at,stamp),
     contact_name=case when stamp>=last_message_at then coalesce(nullif(item->>'contact_name',''),contact_name) else contact_name end
     where id=conversation.id;
   inserted:=inserted+1;
 end loop;
 return jsonb_build_object('inserted',inserted,'ignored',ignored);
end $$;
revoke all on function public.crm_receive_whatsapp(jsonb) from public,anon,authenticated;
grant execute on function public.crm_receive_whatsapp(jsonb) to service_role;
commit;
