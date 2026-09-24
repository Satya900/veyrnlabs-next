begin;
alter table public.crm_whatsapp_outbox add column delivery_status text check(delivery_status in ('sent','failed','delivered','read'));
alter table public.crm_whatsapp_outbox add column delivery_at timestamptz;
alter table public.crm_whatsapp_outbox add column delivery_error_code integer;
grant select(delivery_status,delivery_at,delivery_error_code) on public.crm_whatsapp_outbox to authenticated;
create index crm_outbox_provider_id on public.crm_whatsapp_outbox(provider_message_id);

-- Retain early receipts when Meta's webhook wins the race against the send response.
create table public.crm_whatsapp_receipts (
 organization_id uuid not null,
 connection_id uuid not null,
 message_id text not null check(length(message_id) between 1 and 500),
 recipient text not null check(recipient ~ '^\d{5,20}$'),
 status text not null check(status in ('sent','failed','delivered','read')),
 occurred_at timestamptz not null,
 error_code integer check(error_code>=0),
 primary key(connection_id,message_id,recipient,status),
 foreign key(organization_id,connection_id) references public.crm_whatsapp_connections(organization_id,id)
);
alter table public.crm_whatsapp_receipts enable row level security;
revoke all on public.crm_whatsapp_receipts from public,anon,authenticated;
grant all on public.crm_whatsapp_receipts to service_role;

create function public.crm_apply_delivery_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare receipt public.crm_whatsapp_receipts; c public.crm_whatsapp_conversations;
begin
 if new.provider_message_id is null then return new; end if;
 select * into c from public.crm_whatsapp_conversations where id=new.conversation_id and organization_id=new.organization_id;
 select * into receipt from public.crm_whatsapp_receipts where organization_id=new.organization_id and connection_id=c.connection_id
 and message_id=new.provider_message_id and recipient=c.sender
 order by case status when 'read' then 4 when 'delivered' then 3 when 'failed' then 2 else 1 end desc,occurred_at desc limit 1;
 if found then
 new.delivery_status:=receipt.status;new.delivery_at:=receipt.occurred_at;new.delivery_error_code:=receipt.error_code;
 end if;
 return new;
end $$;
create trigger crm_outbox_delivery before insert or update of provider_message_id on public.crm_whatsapp_outbox
 for each row execute function public.crm_apply_delivery_receipt();

create function public.crm_receive_whatsapp_receipts(events jsonb) returns void language plpgsql security definer set search_path='' as $$
declare event jsonb; c public.crm_whatsapp_connections;
begin
 if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)>500 then raise exception 'Invalid receipt batch'; end if;
 -- Lock the connection consistently across receipt batches, serializing early receipt storage.
 for event in select value from jsonb_array_elements(events) order by value->>'phone_number_id',value->>'message_id',value->>'status' loop
 if coalesce(event->>'status','') not in ('sent','failed','delivered','read') then raise exception 'Invalid delivery status'; end if;
 select * into c from public.crm_whatsapp_connections where phone_number_id=event->>'phone_number_id' and waba_id=event->>'waba_id' for update;
 if not found then continue; end if;
 insert into public.crm_whatsapp_receipts(organization_id,connection_id,message_id,recipient,status,occurred_at,error_code)
 values(c.organization_id,c.id,event->>'message_id',event->>'recipient',event->>'status',(event->>'occurred_at')::timestamptz,(event->>'error_code')::integer)
 on conflict(connection_id,message_id,recipient,status) do update set occurred_at=greatest(public.crm_whatsapp_receipts.occurred_at,excluded.occurred_at),
 error_code=case when excluded.occurred_at>=public.crm_whatsapp_receipts.occurred_at then excluded.error_code else public.crm_whatsapp_receipts.error_code end;
 update public.crm_whatsapp_outbox o set provider_message_id=o.provider_message_id
 from public.crm_whatsapp_conversations chat where o.conversation_id=chat.id and chat.connection_id=c.id
 and o.organization_id=c.organization_id and o.provider_message_id=event->>'message_id' and chat.sender=event->>'recipient';
 end loop;
end $$;
revoke all on function public.crm_apply_delivery_receipt(),public.crm_receive_whatsapp_receipts(jsonb) from public,anon,authenticated;
grant execute on function public.crm_receive_whatsapp_receipts(jsonb) to service_role;
create or replace function public.crm_finish_whatsapp_reply(job uuid, outcome text, message_id text, cost_paise bigint)
returns void language plpgsql security definer set search_path='' as $$
declare item public.crm_whatsapp_outbox;
begin
 if outcome not in ('accepted','rejected','unknown') or outcome is null then raise exception 'Invalid outcome'; end if;
 if outcome='accepted' and (message_id is null or length(message_id) not between 1 and 500) then raise exception 'Missing provider receipt'; end if;
 -- Match receipt ingestion lock order so an early webhook cannot be lost.
 perform 1 from public.crm_whatsapp_connections connection
 join public.crm_whatsapp_conversations chat on chat.connection_id=connection.id
 join public.crm_whatsapp_outbox outbox on outbox.conversation_id=chat.id
 where outbox.id=job for update of connection;
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

commit;
