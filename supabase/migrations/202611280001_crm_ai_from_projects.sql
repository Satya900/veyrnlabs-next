-- The AI now answers from Projects only. Every reply suggestion, draft and automatic reply
-- reads the live projects inventory (the lead's own project first) instead of the free-text
-- "company knowledge" typed in Settings. That text stays in the table but is no longer read,
-- and reply drafts and automatic replies no longer require it: automatic replies need at least
-- one active project instead.
begin;

-- Drafts were only allowed with 20+ characters of knowledge; that rule goes.
do $$
declare con text;
begin
 for con in
  select conname from pg_constraint
  where conrelid='public.crm_ai_settings'::regclass and contype='c'
   and pg_get_constraintdef(oid) like '%drafts_enabled%knowledge%'
 loop
  execute format('alter table public.crm_ai_settings drop constraint %I', con);
 end loop;
end $$;

-- The inventory as plain text for the AI (at most ~7,500 characters). The project the lead is
-- tagged with comes first and is marked, so it is never cut off; then the rest by name, with
-- sold-out projects last. Empty when the workspace has no active projects.
drop function public.crm_inventory_text(uuid);
create function public.crm_inventory_text(org uuid, focus uuid default null) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(left(
  E'PROJECTS AND AVAILABILITY (live from the CRM; the only source for properties, prices and availability. Prices in INR):\n'
  || string_agg(project_text, E'\n' order by is_focus desc, sold_out, name), 7500), '')
 from (
  select p.name, p.id = focus as is_focus, p.status='sold_out' as sold_out,
   '- ' || case when p.id = focus then '[This customer''s project] ' else '' end || p.name
   || coalesce(nullif(', ' || p.location, ', '), '')
   || ' [' || replace(p.status, '_', ' ') || ']'
   || coalesce(nullif(' Possession: ' || p.possession || '.', ' Possession: .'), '')
   || coalesce(nullif(' Developer: ' || p.developer || '.', ' Developer: .'), '')
   || coalesce(nullif(' RERA: ' || p.rera || '.', ' RERA: .'), '')
   || coalesce(nullif(' ' || left(p.description, 400), ' '), '')
   || coalesce(nullif(' Amenities: ' || left(p.amenities, 200) || '.', ' Amenities: .'), '')
   || coalesce((select ' Units: ' || string_agg(
      u.name || coalesce(' ' || nullif(u.size, ''), '')
      || case
          when u.price_min is not null and u.price_max is not null and u.price_max > u.price_min
           then ' ₹' || public.crm_inr_short(u.price_min) || '–' || public.crm_inr_short(u.price_max)
          when coalesce(u.price_min, u.price_max) is not null then ' ₹' || public.crm_inr_short(coalesce(u.price_min, u.price_max))
          else ' price on request' end
      || ' (' || replace(u.availability, '_', ' ') || ')', '; ' order by u.position, u.name) || '.'
     from public.crm_project_units u where u.project_id = p.id), '')
   || case when exists(select 1 from public.crm_project_files f where f.project_id = p.id and f.kind = 'brochure')
      then ' Brochure available: the agent can share it on WhatsApp.' else '' end as project_text
  from public.crm_projects p
  where p.organization_id = org and not p.archived
 ) x
$$;
revoke all on function public.crm_inventory_text(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_inventory_text(uuid, uuid) to service_role;

-- Owners and admins switch reply drafts on or off; there is no knowledge to save any more.
create function public.crm_set_ai_drafts(enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 if enabled is null then raise exception 'Invalid setting'; end if;
 insert into public.crm_ai_settings(organization_id,drafts_enabled) values(public.crm_organization_id(),enabled)
 on conflict(organization_id) do update set drafts_enabled=excluded.drafts_enabled,
 auto_enabled=public.crm_ai_settings.auto_enabled and excluded.drafts_enabled,
 auto_actor=case when excluded.drafts_enabled then public.crm_ai_settings.auto_actor else null end,
 updated_at=clock_timestamp();
end $$;
revoke all on function public.crm_set_ai_drafts(boolean) from public, anon, authenticated;
grant execute on function public.crm_set_ai_drafts(boolean) to authenticated;

-- Patched in place; each fails if the function is not the expected version.
do $$
declare def text;
begin
 -- Drafts and automatic replies.
 select pg_get_functiondef('public.crm_start_ai_draft_before_seats(uuid,uuid,text,bigint)'::regprocedure) into def;
 if position('''knowledge'',s.knowledge||public.crm_inventory_text(s.organization_id),' in def) = 0
  or position('Enable AI drafts and add company knowledge in Settings' in def) = 0 then
  raise exception 'crm_start_ai_draft_before_seats is not the expected version';
 end if;
 def := replace(def, '''knowledge'',s.knowledge||public.crm_inventory_text(s.organization_id),',
  '''knowledge'',public.crm_inventory_text(s.organization_id,(select l.project_id from public.crm_whatsapp_conversations cv join public.crm_leads l on l.id=cv.lead_id where cv.id=conversation)),');
 execute replace(def, 'Enable AI drafts and add company knowledge in Settings', 'Turn on AI reply drafts in Settings');

 -- Reply suggestions and lead insights.
 select pg_get_functiondef('public.crm_lead_insight_context(uuid,uuid)'::regprocedure) into def;
 if position('''knowledge'', coalesce((select left(knowledge, 6000) from public.crm_ai_settings where organization_id=c.organization_id), ''''),' in def) = 0 then
  raise exception 'crm_lead_insight_context is not the expected version';
 end if;
 execute replace(def, '''knowledge'', coalesce((select left(knowledge, 6000) from public.crm_ai_settings where organization_id=c.organization_id), ''''),',
  '''knowledge'', public.crm_inventory_text(c.organization_id, l.project_id),');

 -- Automatic replies need a project to answer from, not knowledge text.
 select pg_get_functiondef('public.crm_set_auto_replies(boolean)'::regprocedure) into def;
 if position('if not found then raise exception ''Save company knowledge first''; end if;' in def) = 0
  or position('if enabled and (not settings.drafts_enabled or length(trim(settings.knowledge))<20) then raise exception ''Enable drafts and save company knowledge first''; end if;' in def) = 0 then
  raise exception 'crm_set_auto_replies is not the expected version';
 end if;
 def := replace(def, 'if not found then raise exception ''Save company knowledge first''; end if;',
  'if not found then raise exception ''Turn on AI reply drafts first''; end if;');
 execute replace(def, 'if enabled and (not settings.drafts_enabled or length(trim(settings.knowledge))<20) then raise exception ''Enable drafts and save company knowledge first''; end if;',
  'if enabled and not settings.drafts_enabled then raise exception ''Turn on AI reply drafts first''; end if;
 if enabled and not exists(select 1 from public.crm_projects p where p.organization_id=org and not p.archived) then raise exception ''Add at least one project first: the AI answers from your Projects''; end if;');
end $$;

commit;
