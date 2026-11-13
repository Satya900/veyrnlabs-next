-- Sending a brochure (or other project file) from the inbox no longer pauses the AI. A typed
-- reply still keeps the AI quiet in that chat for 30 minutes, but a brochure is usually sent
-- mid-conversation, and the customer's questions about it should still get instant answers.
-- File sends get their own outbox origin, 'file'; the quiet-period check looks only at 'manual'.
begin;

alter table public.crm_whatsapp_outbox drop constraint crm_whatsapp_outbox_origin_check;
alter table public.crm_whatsapp_outbox add constraint crm_whatsapp_outbox_origin_check
 check (origin in ('reviewed', 'automatic', 'manual', 'followup', 'file'));

-- Same checks, window, opt-out and usage as a typed reply; only the origin differs, set in the
-- same transaction so an incoming message never sees it as 'manual'.
create function public.crm_prepare_file_reply(actor uuid, conversation uuid, reply_text text, request uuid,
 scoped_org uuid, scoped_phone text, scoped_waba text, cost_paise bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result := public.crm_prepare_manual_reply(actor, conversation, reply_text, request, scoped_org, scoped_phone, scoped_waba, cost_paise);
 if (result->>'run')::boolean then
  update public.crm_whatsapp_outbox set origin='file' where id=(result->>'id')::uuid;
 end if;
 return result;
end $$;
revoke all on function public.crm_prepare_file_reply(uuid,uuid,text,uuid,uuid,text,text,bigint) from public, anon, authenticated;
grant execute on function public.crm_prepare_file_reply(uuid,uuid,text,uuid,uuid,text,text,bigint) to service_role;

commit;
