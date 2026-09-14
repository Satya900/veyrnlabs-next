-- Phase 2: crm_capture_lead now reports whether it actually inserted a new
-- lead (false on a deduplicated retry), so the caller can notify exactly
-- once per genuinely new website enquiry instead of on every retry.
-- Apply once, after 202609150001_crm_saved_views.sql.
begin;
drop function public.crm_capture_lead(uuid,text,text,text,text,text);
create function public.crm_capture_lead(submission uuid, contact_name text, contact_email text, contact_company text, contact_service text, contact_notes text) returns boolean language plpgsql security definer set search_path='' as $$
declare first_stage uuid;
begin
 perform pg_advisory_xact_lock(84921401);
 perform pg_advisory_xact_lock(hashtextextended(lower(contact_email),1));
 if exists(select 1 from public.crm_leads where submission_id=submission) then return false; end if;
 if (select count(*) from public.crm_leads where source='Website' and created_at>now()-interval '1 hour') >= 100 then raise exception 'Enquiry capacity reached. Please try again later.'; end if;
 if (select count(*) from public.crm_leads where lower(email)=lower(contact_email) and source='Website' and created_at>now()-interval '1 hour') >= 3 then raise exception 'Too many enquiries. Please try again later.'; end if;
 select id into first_stage from public.crm_stages where kind='open' order by position limit 1;
 insert into public.crm_leads(name,email,company,service,notes,source,stage_id,submission_id)
 values(contact_name,lower(contact_email),contact_company,contact_service,contact_notes,'Website',first_stage,submission);
 return true;
end $$;
revoke execute on function public.crm_capture_lead(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_capture_lead(uuid,text,text,text,text,text) to service_role;
commit;
