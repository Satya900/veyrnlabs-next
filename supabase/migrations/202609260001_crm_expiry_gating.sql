-- crm_subscriptions.active is only ever set to true (crm_open_usage_period,
-- crm_apply_paid_event); nothing ever sets it back to false when a subscription
-- lapses without renewal. AI and WhatsApp usage already self-expire correctly
-- because crm_reserve_usage requires a currently-live crm_usage_periods row
-- rather than trusting that boolean. Calendar connection, site-visit scheduling,
-- and crm_plan_tier (which gates the Reports view) did not follow that pattern,
-- so a churned customer who paid even once kept those features forever. Switch
-- them to the same "does a live, non-trial usage period exist right now" check.
begin;

create or replace function public.crm_save_calendar_connection(new_calendar_id text, refresh_token_encrypted text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); actor uuid:=(select auth.uid());
begin
 if org is null then raise exception 'Membership unavailable'; end if;
 if not exists(select 1 from public.crm_usage_periods where organization_id=org
   and starts_at<=now() and ends_at>now() and trial_budget_paise is null)
 then raise exception 'Site-visit scheduling requires an active subscription'; end if;
 if nullif(trim(new_calendar_id),'') is null or nullif(trim(refresh_token_encrypted),'') is null
 then raise exception 'Invalid calendar connection'; end if;
 insert into public.crm_calendar_connections(member_id,organization_id,calendar_id,refresh_token_encrypted)
 values(actor,org,new_calendar_id,refresh_token_encrypted)
 on conflict(member_id) do update set
  calendar_id=excluded.calendar_id,refresh_token_encrypted=excluded.refresh_token_encrypted,updated_at=now();
end $$;

create or replace function public.crm_calendar_connection_for_lead(lead uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); lead_row public.crm_leads; c public.crm_calendar_connections;
begin
 if org is null then raise exception 'Membership unavailable'; end if;
 if not exists(select 1 from public.crm_usage_periods where organization_id=org
   and starts_at<=now() and ends_at>now() and trial_budget_paise is null)
 then raise exception 'Site-visit scheduling requires an active subscription'; end if;
 select * into lead_row from public.crm_leads where id=lead and organization_id=org and public.crm_access(owner_id);
 if not found then raise exception 'Lead unavailable'; end if;
 if lead_row.owner_id is null then raise exception 'Assign this lead to an agent before scheduling a site visit'; end if;
 select * into c from public.crm_calendar_connections where member_id=lead_row.owner_id and organization_id=org;
 if not found then raise exception 'The assigned agent has not connected a calendar'; end if;
 return jsonb_build_object('member_id',c.member_id,'calendar_id',c.calendar_id,
  'refresh_token_encrypted',c.refresh_token_encrypted);
end $$;

create or replace function public.crm_plan_tier() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('plan',s.plan,'active',exists(
  select 1 from public.crm_usage_periods p where p.organization_id=public.crm_organization_id()
  and p.starts_at<=now() and p.ends_at>now() and p.trial_budget_paise is null))
 from (select 1) x left join public.crm_subscriptions s on s.organization_id=public.crm_organization_id()
$$;
commit;
