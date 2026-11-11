-- Lead capture matches repeat enquiries by phone first. An email only links an enquiry to an
-- existing lead when one side has no usable number, so two people (or two test numbers)
-- sharing an email address get separate leads and each gets a welcome. The 3-an-hour cap per
-- contact follows the same rule. Patched in place; fails if it isn't the expected version.
begin;

do $$
declare def text;
 old_cap constant text := 'and ((digits<>'''' and e.phone=digits) or (mail<>'''' and e.email=mail))) >= 3';
 old_match constant text := 'and ((digits<>'''' and public.crm_whatsapp_number(l.phone, country)=digits) or (mail<>'''' and lower(l.email)=mail))
 order by l.created_at desc limit 1;';
begin
 select pg_get_functiondef('public.crm_capture_workspace_lead(text,text,text,text,text,numeric,text,text)'::regprocedure) into def;
 if position(old_cap in def) = 0 or position(old_match in def) = 0 then
  raise exception 'crm_capture_workspace_lead is not the expected version';
 end if;
 def := replace(def, old_cap, 'and ((digits<>'''' and e.phone=digits) or (digits='''' and mail<>'''' and e.email=mail))) >= 3');
 def := replace(def, old_match, 'and ((digits<>'''' and public.crm_whatsapp_number(l.phone, country)=digits)
  or (mail<>'''' and lower(l.email)=mail and (digits='''' or public.crm_whatsapp_number(l.phone, country) is null)))
 order by l.created_at desc limit 1;');
 execute def;
end $$;

commit;
