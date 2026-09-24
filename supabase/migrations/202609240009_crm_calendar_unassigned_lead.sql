-- crm_calendar_connection_for_lead collapsed "lead not found/no access" and "lead has no
-- assigned agent" into the same "Lead unavailable" error. An unassigned lead is the default
-- state for every newly created lead, so this fired on the single most common path into
-- scheduling a site visit, with a message that reads like a permissions failure rather than
-- "assign this lead first." Split the two cases.
begin;
create or replace function public.crm_calendar_connection_for_lead(lead uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); lead_row public.crm_leads; c public.crm_calendar_connections;
begin
 if org is null then raise exception 'Membership unavailable'; end if;
 if not exists(select 1 from public.crm_subscriptions where organization_id=org and plan='pro_plus' and active)
 then raise exception 'Automatic scheduling requires an active Pro Plus subscription'; end if;
 select * into lead_row from public.crm_leads where id=lead and organization_id=org and public.crm_access(owner_id);
 if not found then raise exception 'Lead unavailable'; end if;
 if lead_row.owner_id is null then raise exception 'Assign this lead to an agent before scheduling a site visit'; end if;
 select * into c from public.crm_calendar_connections where member_id=lead_row.owner_id and organization_id=org;
 if not found then raise exception 'The assigned agent has not connected a calendar'; end if;
 return jsonb_build_object('member_id',c.member_id,'calendar_id',c.calendar_id,
  'refresh_token_encrypted',c.refresh_token_encrypted);
end $$;
commit;
