-- WhatsApp opt-out that can be undone by the customer. Until now any "stop" ever received in
-- a conversation blocked it forever. Now the customer's most recent stop/start keyword
-- decides: "STOP" (or unsubscribe / opt out) blocks sending, and a later message that is just
-- "START" (or unstop / resume / subscribe) allows it again. Ordinary replies such as "no" or
-- "yes interested" don't change consent either way.
begin;

-- Security invoker: callers only see conversations their row-level security allows, and the
-- security-definer send functions below call it with full access.
create function public.crm_whatsapp_opted_out(conversation uuid) returns boolean
language sql stable set search_path='' as $$
 select coalesce((
  select m.body ~* '(^|[^a-z])(stop|unsubscribe|opt out)([^a-z]|$)'
  from public.crm_whatsapp_messages m
  where m.conversation_id = conversation
   and (m.body ~* '(^|[^a-z])(stop|unsubscribe|opt out)([^a-z]|$)'
    or m.body ~* '^[[:space:]]*(start|unstop|resume|subscribe)[[:space:][:punct:]]*$')
  order by m.sent_at desc, m.received_at desc
  limit 1
 ), false)
$$;
-- For the inbox list: which of these conversations are opted out.
create function public.crm_whatsapp_opted_out_conversations(ids uuid[]) returns setof uuid
language sql stable set search_path='' as $$
 select id from unnest(ids) as id where public.crm_whatsapp_opted_out(id)
$$;
revoke all on function public.crm_whatsapp_opted_out(uuid), public.crm_whatsapp_opted_out_conversations(uuid[]) from public, anon;
grant execute on function public.crm_whatsapp_opted_out(uuid), public.crm_whatsapp_opted_out_conversations(uuid[]) to authenticated, service_role;

-- Swap the old "any stop ever" check for the new rule in the deployed reply and follow-up
-- functions, keeping the rest of their live definitions. Fails loudly if a definition no
-- longer contains the expected check, rather than leaving the old rule in place.
do $$
declare
 f record;
 def text;
 changed integer := 0;
 old_reply constant text := 'exists(select 1 from public.crm_whatsapp_messages where conversation_id=c.id and body ~* ''(^|[^a-z])(stop|unsubscribe|opt out)([^a-z]|$)'')';
 old_due constant text := 'exists(select 1 from public.crm_whatsapp_messages msg
      where msg.conversation_id=c.id and msg.body ~* ''(^|[^a-z])(stop|unsubscribe|opt out)([^a-z]|$)'')';
begin
 for f in
  select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
   and p.proname in ('crm_prepare_whatsapp_reply_before_seats', 'crm_prepare_manual_reply', 'crm_whatsapp_followup_due')
 loop
  def := pg_get_functiondef(f.oid);
  if f.proname = 'crm_whatsapp_followup_due' then
   if position(old_due in def) = 0 then raise exception 'Opt-out check not found in %', f.proname; end if;
   def := replace(def, old_due, 'public.crm_whatsapp_opted_out(c.id)');
  else
   if position(old_reply in def) = 0 then raise exception 'Opt-out check not found in %', f.proname; end if;
   def := replace(def, old_reply, 'public.crm_whatsapp_opted_out(c.id)');
  end if;
  execute def;
  changed := changed + 1;
 end loop;
 if changed <> 3 then raise exception 'Expected 3 functions to update, found %', changed; end if;
end $$;

commit;
