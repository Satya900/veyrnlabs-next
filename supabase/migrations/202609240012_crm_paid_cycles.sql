begin;
alter table public.crm_billing_subscriptions drop constraint crm_billing_subscriptions_status_check;
alter table public.crm_billing_subscriptions add constraint crm_billing_subscriptions_status_check check(status in ('created','authenticated','active','pending','halted','paused','cancelled','completed','expired'));
alter table public.crm_billing_subscriptions add column event_at timestamptz;
create table public.crm_seat_subscriptions (
 id text primary key, organization_id uuid not null references public.crm_organizations(id),
 plan_id text not null, quantity integer not null check(quantity between 1 and 100),
 status text not null default 'created', event_at timestamptz
);
create table public.crm_paid_cycles (
 payment_id text primary key, organization_id uuid not null references public.crm_organizations(id),
 subscription_id text not null, kind text not null check(kind in ('base','seats')),
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 quantity integer not null default 1, amount_paise bigint not null,
 unique(subscription_id,starts_at)
);
create table public.crm_checkout_attempts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.crm_organizations(id),
 kind text not null check(kind in ('base','seats')), plan text, months integer, quantity integer not null,
 status text not null default 'creating' check(status in ('creating','ready','unknown','closed')),
 subscription_id text, created_at timestamptz not null default now()
);
alter table public.crm_seat_subscriptions enable row level security;
alter table public.crm_paid_cycles enable row level security;
alter table public.crm_checkout_attempts enable row level security;
revoke all on public.crm_seat_subscriptions,public.crm_paid_cycles,public.crm_checkout_attempts from public,anon,authenticated;
grant all on public.crm_seat_subscriptions,public.crm_paid_cycles,public.crm_checkout_attempts to service_role;

create function public.crm_paid_seats(org uuid) returns integer language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.crm_seat_subscriptions where organization_id=org)
 then coalesce((select sum(quantity)::integer from public.crm_paid_cycles where organization_id=org and kind='seats' and starts_at<=now() and ends_at>now()),0)
 else coalesce((select purchased_seats from public.crm_subscriptions where organization_id=org),0) end
$$;
create or replace function public.crm_check_seat_allowance() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.crm_subscriptions;
begin
 if tg_op='UPDATE' and new.organization_id=old.organization_id then return new; end if;
 perform 1 from public.crm_organizations where id=new.organization_id for update;
 select * into s from public.crm_subscriptions where organization_id=new.organization_id;
 if found and (select count(*) from public.crm_members where organization_id=new.organization_id and id<>new.id)>=(case s.plan when 'pro' then 1 else 3 end)+public.crm_paid_seats(new.organization_id) then raise exception 'Included seats are full. Purchase an additional seat before accepting this invitation.' using errcode='P0701'; end if;
 return new;
end $$;

create function public.crm_begin_checkout(checkout_kind text, selected_plan text, months integer, seats integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); attempt public.crm_checkout_attempts; b public.crm_billing_subscriptions;
begin
 if org is null or public.crm_role()<>'owner' then raise exception 'Only the owner manages billing'; end if;
 if checkout_kind is null or checkout_kind not in ('base','seats') or seats is null or seats not between 1 and 100 then raise exception 'Invalid checkout'; end if;
 if checkout_kind='base' and (selected_plan is null or selected_plan not in ('pro','pro_plus') or months is null or months not in (1,3,12) or seats<>1) then raise exception 'Invalid plan'; end if;
 if checkout_kind='seats' and not exists(select 1 from public.crm_usage_periods where organization_id=org and trial_budget_paise is null and starts_at<=now() and ends_at>now()) then raise exception 'Activate a paid plan before buying seats'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text,5));
 if checkout_kind='base' then
  select * into b from public.crm_billing_subscriptions where organization_id=org;
  if found and b.status not in ('cancelled','completed','expired') then
   if b.status='created' then return jsonb_build_object('run',false,'subscription_id',b.razorpay_subscription_id,'status','ready'); end if;
   raise exception 'A subscription already exists. Manage it before choosing a new plan';
  end if;
 end if;
 select * into attempt from public.crm_checkout_attempts where organization_id=org and kind=checkout_kind and status in ('creating','unknown') order by created_at desc limit 1;
 if found then return jsonb_build_object('run',false,'status',attempt.status,'id',attempt.id); end if;
 insert into public.crm_checkout_attempts(organization_id,kind,plan,months,quantity) values(org,checkout_kind,selected_plan,months,seats) returning * into attempt;
 return jsonb_build_object('run',true,'id',attempt.id);
end $$;
create function public.crm_finish_checkout(attempt_id uuid, provider_id text, provider_plan text) returns void language plpgsql security definer set search_path='' as $$
declare a public.crm_checkout_attempts;
begin
 select * into a from public.crm_checkout_attempts where id=attempt_id for update;
 if not found then raise exception 'Checkout unavailable'; end if;
 if a.status='ready' and a.subscription_id=provider_id then return; end if;
 if a.status not in ('creating','unknown') then raise exception 'Checkout already finalized'; end if;
 if provider_id='' then update public.crm_checkout_attempts set status='closed' where id=a.id; return; end if;
 if provider_id is null then update public.crm_checkout_attempts set status='unknown' where id=a.id; return; end if;
 if a.kind='base' then
 insert into public.crm_billing_subscriptions(organization_id,razorpay_subscription_id,razorpay_plan_id,plan,billing_months,status) values(a.organization_id,provider_id,provider_plan,a.plan,a.months,'created')
 on conflict(organization_id) do update set razorpay_subscription_id=excluded.razorpay_subscription_id,razorpay_plan_id=excluded.razorpay_plan_id,plan=excluded.plan,billing_months=excluded.billing_months,status='created',event_at=null;
 else insert into public.crm_seat_subscriptions(id,organization_id,plan_id,quantity) values(provider_id,a.organization_id,provider_plan,a.quantity); end if;
 update public.crm_checkout_attempts set status='ready',subscription_id=provider_id where id=a.id;
end $$;

create function public.crm_apply_paid_event(event_key text, subscription_id text, provider_plan text, new_status text, occurred_at timestamptz, payment_id text, cycle_start timestamptz, cycle_end timestamptz, paid_amount bigint, currency text, overhead bigint, ai_allowance integer, whatsapp_allowance integer)
returns void language plpgsql security definer set search_path='' as $$
declare b public.crm_billing_subscriptions; seat public.crm_seat_subscriptions; org uuid; expected bigint; monthly bigint; period_start timestamptz; period_end timestamptz; i integer; previous uuid;
begin
 if event_key is null or new_status is null or new_status not in ('created','authenticated','active','pending','halted','paused','cancelled','completed','expired') or occurred_at is null then raise exception 'Invalid event'; end if;
 insert into public.crm_billing_webhook_events(id) values(event_key) on conflict do nothing;
 if not found then return; end if;
 select * into b from public.crm_billing_subscriptions where razorpay_subscription_id=subscription_id for update;
 if found then
  org:=b.organization_id;
  if provider_plan is distinct from b.razorpay_plan_id then raise exception 'Plan mismatch'; end if;
  if b.event_at is null or occurred_at>=b.event_at then update public.crm_billing_subscriptions set status=new_status,event_at=occurred_at,updated_at=now() where organization_id=org; end if;
 else
  select * into seat from public.crm_seat_subscriptions where id=subscription_id for update;
  if not found then raise exception 'Unknown subscription'; end if;
  org:=seat.organization_id;
  if provider_plan is distinct from seat.plan_id then raise exception 'Plan mismatch'; end if;
  if seat.event_at is null or occurred_at>=seat.event_at then update public.crm_seat_subscriptions set status=new_status,event_at=occurred_at where id=subscription_id; end if;
 end if;
 if payment_id is null then return; end if;
 if cycle_start is null or cycle_end is null or cycle_end<=cycle_start or currency is distinct from 'INR' then raise exception 'Invalid paid cycle'; end if;
 if b.organization_id is not null then
  monthly:=(case b.plan when 'pro' then 400000 else 600000 end)*(case b.billing_months when 1 then 100 when 3 then 90 else 80 end)/100;
  expected:=monthly*b.billing_months;
  if abs(extract(epoch from cycle_end-(cycle_start+make_interval(months=>b.billing_months))))>86400 then raise exception 'Billing duration mismatch'; end if;
 else expected:=50000*seat.quantity;
  if abs(extract(epoch from cycle_end-(cycle_start+interval '1 month')))>86400 then raise exception 'Seat duration mismatch'; end if;
 end if;
 if paid_amount is distinct from expected then raise exception 'Payment amount mismatch'; end if;
 perform 1 from public.crm_organizations where id=org for update;
 insert into public.crm_paid_cycles(payment_id,organization_id,subscription_id,kind,starts_at,ends_at,quantity,amount_paise)
 values(payment_id,org,subscription_id,case when b.organization_id is not null then 'base' else 'seats' end,cycle_start,cycle_end,coalesce(seat.quantity,1),paid_amount) on conflict do nothing;
 if not found then return; end if;
 if b.organization_id is null then return; end if;
 if overhead is null or overhead<=0 or overhead>=monthly*70/100 or ai_allowance is null or ai_allowance<=0 or whatsapp_allowance is null or whatsapp_allowance<=0 then raise exception 'Invalid allowances'; end if;
 insert into public.crm_subscriptions(organization_id,plan,billing_months,active) values(org,b.plan,b.billing_months,true)
 on conflict(organization_id) do update set plan=excluded.plan,billing_months=excluded.billing_months,active=true;
 -- Paid slices are stored up front; no monthly cron is required to keep prepaid access alive.
 for i in 0..b.billing_months-1 loop
  period_start:=cycle_start+make_interval(months=>i);
  period_end:=least(cycle_start+make_interval(months=>i+1),cycle_end);
  if period_end<=period_start then continue; end if;
  update public.crm_usage_periods set ends_at=period_start where organization_id=org and starts_at<period_start and ends_at>period_start;
  select id into previous from public.crm_usage_periods where organization_id=org and starts_at>=period_start and starts_at<period_end and trial_budget_paise is null limit 1;
  if found then
   -- Preserve existing spent/reserved usage when reconciling a charge from the earlier release.
   update public.crm_usage_periods set starts_at=period_start,ends_at=period_end where id=previous;
  else
   if exists(select 1 from public.crm_usage_periods where organization_id=org and starts_at<period_end and ends_at>period_start) then raise exception 'Overlapping usage period needs review'; end if;
   insert into public.crm_usage_periods(organization_id,starts_at,ends_at,revenue_paise,overhead_paise,ai_limit,whatsapp_limit) values(org,period_start,period_end,monthly,overhead,ai_allowance,whatsapp_allowance);
  end if;
 end loop;
end $$;

alter function public.crm_usage_summary() rename to crm_usage_summary_before_cycles;
create function public.crm_usage_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; org uuid:=public.crm_organization_id();
begin
 result:=public.crm_usage_summary_before_cycles();
 return result || jsonb_build_object('purchased_seats',public.crm_paid_seats(org),'seat_subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'quantity',quantity,'status',status)) from public.crm_seat_subscriptions where organization_id=org and status not in ('cancelled','completed','expired')),'[]'::jsonb));
end $$;
revoke all on function public.crm_paid_seats(uuid),public.crm_begin_checkout(text,text,integer,integer),public.crm_finish_checkout(uuid,text,text),public.crm_apply_paid_event(text,text,text,text,timestamptz,text,timestamptz,timestamptz,bigint,text,bigint,integer,integer),public.crm_usage_summary_before_cycles(),public.crm_usage_summary() from public,anon,authenticated;
grant execute on function public.crm_begin_checkout(text,text,integer,integer),public.crm_usage_summary() to authenticated;
grant execute on function public.crm_paid_seats(uuid),public.crm_finish_checkout(uuid,text,text),public.crm_apply_paid_event(text,text,text,text,timestamptz,text,timestamptz,timestamptz,bigint,text,bigint,integer,integer) to service_role;
-- Retire the old activation entry point: it grants a month without checking a captured payment.
revoke execute on function public.crm_apply_billing_webhook(text,text,text,boolean,bigint,integer,integer) from service_role;
revoke execute on function public.crm_start_subscription(text,integer,text,text) from authenticated;
commit;
