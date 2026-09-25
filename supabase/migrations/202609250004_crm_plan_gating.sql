-- Two pricing-page promises were not actually enforced in the database:
-- 1. Free and Pro both promise "1 included user", but the seat trigger only checked
--    the cap once an org had a crm_subscriptions row; an org that never subscribed
--    could add unlimited members.
-- 2. Pro promises "manual site-visit scheduling", but the calendar connection and the
--    lead-scoped credential lookup both required plan='pro_plus' specifically. Automatic
--    booking from WhatsApp (crm_prepare_auto_booking) already has its own independent
--    pro_plus check and is untouched by this migration.
begin;

create or replace function public.crm_check_seat_allowance() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.crm_subscriptions; cap integer;
begin
 if tg_op='UPDATE' and new.organization_id=old.organization_id then return new; end if;
 perform 1 from public.crm_organizations where id=new.organization_id for update;
 select * into s from public.crm_subscriptions where organization_id=new.organization_id;
 cap := case when found then (case s.plan when 'pro' then 1 else 3 end)+public.crm_paid_seats(new.organization_id) else 1 end;
 if (select count(*) from public.crm_members where organization_id=new.organization_id and id<>new.id) >= cap
 then raise exception 'Included seats are full. Purchase an additional seat before accepting this invitation.' using errcode='P0701'; end if;
 return new;
end $$;

create or replace function public.crm_save_calendar_connection(new_calendar_id text, refresh_token_encrypted text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); actor uuid:=(select auth.uid());
begin
 if org is null then raise exception 'Membership unavailable'; end if;
 if not exists(select 1 from public.crm_subscriptions where organization_id=org and active)
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
 if not exists(select 1 from public.crm_subscriptions where organization_id=org and active)
 then raise exception 'Site-visit scheduling requires an active subscription'; end if;
 select * into lead_row from public.crm_leads where id=lead and organization_id=org and public.crm_access(owner_id);
 if not found then raise exception 'Lead unavailable'; end if;
 if lead_row.owner_id is null then raise exception 'Assign this lead to an agent before scheduling a site visit'; end if;
 select * into c from public.crm_calendar_connections where member_id=lead_row.owner_id and organization_id=org;
 if not found then raise exception 'The assigned agent has not connected a calendar'; end if;
 return jsonb_build_object('member_id',c.member_id,'calendar_id',c.calendar_id,
  'refresh_token_encrypted',c.refresh_token_encrypted);
end $$;

-- Every member (not just owner/admin) needs to know the org's plan tier to decide whether
-- to show Pro-Plus-only UI such as Reports. Unlike crm_usage_summary, this exposes no costs,
-- usage counts, or revenue, so it carries no admin-only restriction.
create function public.crm_plan_tier() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('plan',s.plan,'active',coalesce(s.active,false))
 from (select 1) x left join public.crm_subscriptions s on s.organization_id=public.crm_organization_id()
$$;
revoke all on function public.crm_plan_tier() from public,anon;
grant execute on function public.crm_plan_tier() to authenticated;
commit;
