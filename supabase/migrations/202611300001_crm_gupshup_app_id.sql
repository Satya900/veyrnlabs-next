-- Blue ticks: a Gupshup number marks a customer's message as read through
-- PUT /wa/app/{appId}/msg/{msgId}/read, which needs the app's ID (a UUID from the Gupshup
-- dashboard), not just its name. The owner adds it in Settings; it isn't a secret.
begin;
alter table public.crm_whatsapp_connections add column provider_app_id uuid;
grant select (provider_app_id) on public.crm_whatsapp_connections to authenticated;
commit;
