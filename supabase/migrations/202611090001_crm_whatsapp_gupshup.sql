-- WhatsApp through the workspace's own Gupshup app.
--
-- A Gupshup number is an ordinary WhatsApp connection with provider = 'gupshup'. Its
-- conversations, messages, receipts, AI drafts and outbox use the existing tables and
-- functions unchanged: the Gupshup webhook converts payloads into the same events Meta's
-- do, keyed by waba_id '0' and the number as phone_number_id. The Gupshup API key is
-- stored encrypted in crm_whatsapp_credentials, exactly like a Meta token.
--
-- Gupshup doesn't sign callbacks, so each connection gets an unguessable callback token
-- that forms part of its webhook URL.
begin;

alter table public.crm_whatsapp_connections
 add column provider text not null default 'meta' check (provider in ('meta', 'gupshup')),
 add column provider_app text check (provider_app is null or provider_app ~ '^[A-Za-z0-9_.-]{1,100}$'),
 add column callback_token text unique check (callback_token is null or callback_token ~ '^[a-f0-9]{64}$'),
 add constraint crm_whatsapp_connections_gupshup_check check (
  provider = 'meta' or (provider_app is not null and callback_token is not null and waba_id = '0'));

-- The callback token is a secret (it's the webhook's only credential): signed-in members
-- may read every connection column except it. The server reads it with the service role.
revoke select on public.crm_whatsapp_connections from authenticated;
grant select (id, organization_id, waba_id, phone_number_id, display_phone, active, created_at, provider, provider_app)
 on public.crm_whatsapp_connections to authenticated;

-- Connects (or re-keys) the workspace's Gupshup number. A disconnected number from either
-- provider may be replaced; a different number that's still connected may not, so live
-- conversations never silently move numbers.
create function public.crm_save_gupshup_connection(
 actor uuid, app text, phone text, display_number text, encrypted_key text, token text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid; existing public.crm_whatsapp_connections;
begin
 select organization_id into org from public.crm_members where id=actor and role='owner';
 if not found then raise exception 'Only the owner connects WhatsApp'; end if;
 if app is null or app !~ '^[A-Za-z0-9_.-]{1,100}$' then raise exception 'Enter the Gupshup app name'; end if;
 if phone is null or phone !~ '^[0-9]{8,15}$' then raise exception 'Enter the number with country code, digits only'; end if;
 if nullif(encrypted_key,'') is null or token is null or token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credentials'; end if;
 perform 1 from public.crm_organizations where id=org for update;
 select * into existing from public.crm_whatsapp_connections where organization_id=org;
 if found and existing.active and existing.phone_number_id<>phone then
  raise exception 'A different number is connected. Disconnect it first.';
 end if;
 insert into public.crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active,provider,provider_app,callback_token)
 values(org,'0',phone,left(coalesce(nullif(trim(display_number),''),'+'||phone),50),true,'gupshup',app,token)
 on conflict(organization_id) do update set waba_id='0',phone_number_id=excluded.phone_number_id,
  display_phone=excluded.display_phone,active=true,provider='gupshup',provider_app=excluded.provider_app,
  callback_token=excluded.callback_token;
 insert into public.crm_whatsapp_credentials(organization_id,token_encrypted,expires_at) values(org,encrypted_key,null)
 on conflict(organization_id) do update set token_encrypted=excluded.token_encrypted,expires_at=null,checked_at=now();
end $$;
revoke all on function public.crm_save_gupshup_connection(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_save_gupshup_connection(uuid,text,text,text,text,text) to service_role;

-- Meta Embedded Signup: same rule for replacing a disconnected number, and switching from
-- Gupshup back to Meta clears the Gupshup fields.
create or replace function public.crm_save_whatsapp_connection(actor uuid, waba text, phone text, display_number text, encrypted_token text, expires timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid; existing public.crm_whatsapp_connections;
begin
 select organization_id into org from public.crm_members where id=actor and role='owner';
 if not found then raise exception 'Only the owner connects WhatsApp'; end if;
 if nullif(encrypted_token,'') is null or (expires is not null and expires<=now()) then raise exception 'Invalid credentials'; end if;
 perform 1 from public.crm_organizations where id=org for update;
 select * into existing from public.crm_whatsapp_connections where organization_id=org;
 if found and existing.active and existing.phone_number_id<>phone then
  raise exception 'A different number is already linked. Contact support to migrate conversation history';
 end if;
 insert into public.crm_whatsapp_connections(organization_id,waba_id,phone_number_id,display_phone,active) values(org,waba,phone,display_number,true)
 on conflict(organization_id) do update set waba_id=excluded.waba_id,phone_number_id=excluded.phone_number_id,
  display_phone=excluded.display_phone,active=true,provider='meta',provider_app=null,callback_token=null;
 insert into public.crm_whatsapp_credentials(organization_id,token_encrypted,expires_at) values(org,encrypted_token,expires)
 on conflict(organization_id) do update set token_encrypted=excluded.token_encrypted,expires_at=excluded.expires_at,checked_at=now();
end $$;
commit;
