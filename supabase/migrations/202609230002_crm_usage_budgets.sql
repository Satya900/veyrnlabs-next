-- Internal cost accounting uses INR paise. No customer subscription is activated here.
begin;
create table public.crm_subscriptions (
 organization_id uuid primary key references public.crm_organizations(id),
 plan text not null check(plan in ('pro','pro_plus')),
 billing_months integer not null check(billing_months in (1,3,12)),
 active boolean not null default false,
 purchased_seats integer not null default 0 check(purchased_seats between 0 and 10000)
);
create table public.crm_usage_periods (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.crm_subscriptions(organization_id),
 starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at > starts_at),
 revenue_paise bigint not null check(revenue_paise > 0),
 cost_ceiling_paise bigint generated always as (revenue_paise * 70 / 100) stored,
 overhead_paise bigint not null check(overhead_paise > 0),
 ai_limit integer not null check(ai_limit > 0),
 whatsapp_limit integer not null check(whatsapp_limit > 0),
 check(overhead_paise < revenue_paise * 70 / 100),
 unique(organization_id,id)
);
create table public.crm_usage_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 period_id uuid not null,
 event_key text not null check(length(event_key) between 1 and 200),
 kind text not null check(kind in ('ai','whatsapp','overhead')),
 units integer not null check(units > 0),
 reserved_paise bigint not null check(reserved_paise > 0),
 actual_paise bigint check(actual_paise >= 0),
 status text not null default 'reserved' check(status in ('reserved','settled','cancelled')),
 created_at timestamptz not null default now(),
 foreign key(organization_id,period_id) references public.crm_usage_periods(organization_id,id),
 unique(organization_id,event_key),
 check((status='settled' and actual_paise is not null) or (status<>'settled' and actual_paise is null))
);
create index crm_usage_events_period on public.crm_usage_events(period_id);
alter table public.crm_subscriptions enable row level security;
alter table public.crm_usage_periods enable row level security;
alter table public.crm_usage_events enable row level security;
revoke all on public.crm_subscriptions,public.crm_usage_periods,public.crm_usage_events from public,anon,authenticated;
grant all on public.crm_subscriptions,public.crm_usage_periods,public.crm_usage_events to service_role;

-- Only a trusted billing/operator process may provision a paid entitlement.
-- Each usage period is one month, even for quarterly/annual prepaid subscriptions.
create function public.crm_open_usage_period(
 org uuid, selected_plan text, months integer, period_start timestamptz, period_end timestamptz,
 overhead bigint, ai_allowance integer, whatsapp_allowance integer, paid_seats integer default 0
) returns uuid language plpgsql security definer set search_path='' as $$
declare revenue bigint; result uuid; seats integer;
begin
 if selected_plan is null or selected_plan not in ('pro','pro_plus') or months is null or months not in (1,3,12)
   or period_start is null or period_end is null
   or period_start > now() or period_end <= now()
   or period_end <= period_start or period_end > period_start + interval '1 month'
 then raise exception 'Invalid plan or monthly period'; end if;
 -- Also serializes the first subscription creation and overlapping renewal requests.
 perform 1 from public.crm_organizations where id=org for update;
 if not found then raise exception 'Unknown organization'; end if;
 if exists(select 1 from public.crm_usage_periods where organization_id=org
   and starts_at < period_end and ends_at > period_start)
 then raise exception 'Usage periods cannot overlap'; end if;
 seats := case when selected_plan='pro' then 1 else 3 end;
 if (select count(*) from public.crm_members where organization_id=org) > seats + paid_seats
 then raise exception 'Existing members exceed purchased seats'; end if;
 revenue := (case when selected_plan='pro' then 400000 else 600000 end)
   * (case months when 1 then 100 when 3 then 90 else 80 end) / 100;
 insert into public.crm_subscriptions(organization_id,plan,billing_months,active,purchased_seats)
 values(org,selected_plan,months,true,paid_seats)
 on conflict(organization_id) do update set plan=excluded.plan,billing_months=excluded.billing_months,
   active=true,purchased_seats=excluded.purchased_seats;
 insert into public.crm_usage_periods(organization_id,starts_at,ends_at,revenue_paise,overhead_paise,ai_limit,whatsapp_limit)
 values(org,period_start,period_end,revenue,overhead,ai_allowance,whatsapp_allowance) returning id into result;
 return result;
end $$;

-- Reservations and settlements lock the same period: simultaneous workers cannot overspend it.
create function public.crm_reserve_usage(org uuid, request_key text, usage_kind text, quantity integer, max_cost_paise bigint)
 returns uuid language plpgsql security definer set search_path='' as $$
declare p public.crm_usage_periods; old public.crm_usage_events; spent bigint; used bigint; allowance integer; result uuid;
begin
 if request_key is null or length(request_key) not between 1 and 200
   or usage_kind is null or usage_kind not in ('ai','whatsapp','overhead')
   or quantity is null or quantity <= 0 or max_cost_paise is null or max_cost_paise <= 0
 then raise exception 'Invalid usage reservation'; end if;
 select * into p from public.crm_usage_periods where organization_id=org and starts_at<=now() and ends_at>now() for update;
 if not found then raise exception 'No active usage period'; end if;
 -- A replay is only a receipt; the caller must never dispatch the provider call again.
 select * into old from public.crm_usage_events where organization_id=org and event_key=request_key;
 if found then
   if old.period_id<>p.id or old.kind<>usage_kind or old.units<>quantity or old.reserved_paise<>max_cost_paise
   then raise exception 'Usage key conflict'; end if;
   raise exception 'Usage already reserved' using errcode='23505';
 end if;
 if not exists(select 1 from public.crm_subscriptions where organization_id=org and active)
 then raise exception 'Subscription inactive'; end if;
 select coalesce(sum(case when status='settled' then actual_paise else reserved_paise end),0),
   coalesce(sum(case when kind=usage_kind then units else 0 end),0)
 into spent,used from public.crm_usage_events where period_id=p.id and status<>'cancelled';
 if p.overhead_paise + spent + max_cost_paise > p.cost_ceiling_paise
 then raise exception 'Service budget reached'; end if;
 allowance := case usage_kind when 'ai' then p.ai_limit when 'whatsapp' then p.whatsapp_limit else null end;
 if allowance is not null and used+quantity>allowance then raise exception 'Usage allowance reached'; end if;
 insert into public.crm_usage_events(organization_id,period_id,event_key,kind,units,reserved_paise)
 values(org,p.id,request_key,usage_kind,quantity,max_cost_paise) returning id into result;
 return result;
end $$;

-- Settle even if actual cost exceeds the estimate: never hide incurred costs.
-- A timeout is NOT evidence that a provider incurred no cost; keep it reserved until reconciled.
create function public.crm_finish_usage(org uuid, event uuid, final_cost_paise bigint, cancel boolean default false)
 returns void language plpgsql security definer set search_path='' as $$
declare item public.crm_usage_events;
begin
 if cancel is null or (not cancel and (final_cost_paise is null or final_cost_paise<0))
   or (cancel and final_cost_paise is distinct from 0::bigint)
 then raise exception 'Invalid settlement'; end if;
 select * into item from public.crm_usage_events where id=event and organization_id=org;
 if not found then raise exception 'Unknown usage event'; end if;
 perform 1 from public.crm_usage_periods where id=item.period_id for update;
 select * into item from public.crm_usage_events where id=event and organization_id=org for update;
 if item.status<>'reserved' then
   if (cancel and item.status='cancelled') or (not cancel and item.status='settled' and item.actual_paise=final_cost_paise) then return; end if;
   raise exception 'Usage already finalized';
 end if;
 update public.crm_usage_events set status=case when cancel then 'cancelled' else 'settled' end,
   actual_paise=case when cancel then null else final_cost_paise end where id=event;
end $$;

-- Customer-facing summary deliberately excludes costs, revenue and margin.
create function public.crm_usage_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid; s public.crm_subscriptions; p public.crm_usage_periods; ai bigint; wa bigint; spent bigint; result jsonb;
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 org := public.crm_organization_id();
 select * into s from public.crm_subscriptions where organization_id=org;
 if not found then return jsonb_build_object('status','unconfigured'); end if;
 result := jsonb_build_object('status','inactive','plan',s.plan,'billing_months',s.billing_months,
   'included_seats',case when s.plan='pro' then 1 else 3 end,'purchased_seats',s.purchased_seats,
   'member_count',(select count(*) from public.crm_members where organization_id=org),
   'automatic_scheduling',s.plan='pro_plus');
 select * into p from public.crm_usage_periods where organization_id=org and starts_at<=now() and ends_at>now();
 if not found or not s.active then return result; end if;
 select coalesce(sum(units) filter(where kind='ai'),0),coalesce(sum(units) filter(where kind='whatsapp'),0),
   coalesce(sum(case when status='settled' then actual_paise else reserved_paise end),0)
 into ai,wa,spent from public.crm_usage_events where period_id=p.id and status<>'cancelled';
 return result || jsonb_build_object('status','active','period_end',p.ends_at,'ai_limit',p.ai_limit,'ai_used',ai,
   'whatsapp_limit',p.whatsapp_limit,'whatsapp_used',wa,'automation_paused',p.overhead_paise+spent>=p.cost_ceiling_paise);
end $$;

-- Applies at acceptance/insertion; creating an invitation does not purchase a seat.
create function public.crm_check_seat_allowance() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.crm_subscriptions;
begin
 if tg_op='UPDATE' and new.organization_id=old.organization_id then return new; end if;
 perform 1 from public.crm_organizations where id=new.organization_id for update;
 select * into s from public.crm_subscriptions where organization_id=new.organization_id;
 if found and (select count(*) from public.crm_members where organization_id=new.organization_id and id<>new.id)
   >= (case when s.plan='pro' then 1 else 3 end) + s.purchased_seats
 then raise exception 'Included seats are full. Arrange an additional seat before accepting this invitation.' using errcode='P0701'; end if;
 return new;
end $$;
create trigger crm_member_seat_allowance before insert or update of organization_id on public.crm_members
 for each row execute function public.crm_check_seat_allowance();

revoke all on function public.crm_open_usage_period(uuid,text,integer,timestamptz,timestamptz,bigint,integer,integer,integer),
 public.crm_reserve_usage(uuid,text,text,integer,bigint),public.crm_finish_usage(uuid,uuid,bigint,boolean),
 public.crm_check_seat_allowance(),public.crm_usage_summary() from public,anon,authenticated;
grant execute on function public.crm_open_usage_period(uuid,text,integer,timestamptz,timestamptz,bigint,integer,integer,integer),
 public.crm_reserve_usage(uuid,text,text,integer,bigint),public.crm_finish_usage(uuid,uuid,bigint,boolean) to service_role;
grant execute on function public.crm_usage_summary() to authenticated;
commit;
