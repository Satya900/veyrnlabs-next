-- First-month AI bonus: a workspace's first paid month gets a larger AI allowance (the server
-- passes it as first_ai_allowance). Renewals, later months of a quarterly/annual prepay, and
-- workspaces that have paid before get the normal monthly allowance.
--
-- Rewrites the deployed crm_apply_paid_event rather than restating it, adding one optional
-- parameter and changing only the AI limit of a newly opened period. Fails if the expected
-- text isn't there, so it can never half-apply.
begin;

do $$
declare
 def text;
 old_head constant text := 'whatsapp_allowance integer)';
 old_insert constant text := 'values(org,period_start,period_end,monthly,overhead,ai_allowance,whatsapp_allowance)';
begin
 select pg_get_functiondef(p.oid) into strict def
 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'crm_apply_paid_event';
 if position(old_head in def) = 0 or position(old_insert in def) = 0 then
  raise exception 'crm_apply_paid_event is not the expected version';
 end if;
 def := replace(def, old_head, 'whatsapp_allowance integer, first_ai_allowance integer DEFAULT NULL)');
 def := replace(def, old_insert,
  'values(org,period_start,period_end,monthly,overhead,'
  || 'case when i=0 and first_ai_allowance>ai_allowance and not exists(select 1 from public.crm_usage_periods earlier '
  || 'where earlier.organization_id=org and earlier.trial_budget_paise is null and earlier.starts_at<period_start) '
  || 'then first_ai_allowance else ai_allowance end,whatsapp_allowance)');
 -- The new signature is a separate function; drop the old one so calls can't be ambiguous.
 drop function public.crm_apply_paid_event(text,text,text,text,timestamptz,text,timestamptz,timestamptz,bigint,text,bigint,integer,integer);
 execute def;
end $$;

revoke all on function public.crm_apply_paid_event(text,text,text,text,timestamptz,text,timestamptz,timestamptz,bigint,text,bigint,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.crm_apply_paid_event(text,text,text,text,timestamptz,text,timestamptz,timestamptz,bigint,text,bigint,integer,integer,integer) to service_role;

commit;
