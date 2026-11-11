-- Lead capture: a repeat enquiry is recognised by phone number only. Email is just another way
-- to reach someone, so it never links an enquiry to an existing lead; an enquiry without a
-- usable number always creates a new lead. (Numbers are compared in one form, so
-- +91 79828 25136, 7982825136 and 07982825136 are the same.) The 3-an-hour cap per contact
-- still uses the email when there is no number, as spam protection only.
-- Patched in place; fails if it isn't the expected version.
begin;

do $$
declare def text;
 old_match constant text := 'and ((digits<>'''' and public.crm_whatsapp_number(l.phone, country)=digits)
  or (mail<>'''' and lower(l.email)=mail and (digits='''' or public.crm_whatsapp_number(l.phone, country) is null)))';
begin
 select pg_get_functiondef('public.crm_capture_workspace_lead(text,text,text,text,text,numeric,text,text)'::regprocedure) into def;
 if position(old_match in def) = 0 then
  raise exception 'crm_capture_workspace_lead is not the expected version';
 end if;
 execute replace(def, old_match, 'and digits<>'''' and public.crm_whatsapp_number(l.phone, country)=digits');
end $$;

commit;
