-- New price card: Pro ₹499, Pro Plus ₹699, extra seats ₹199 (all per month, GST extra).
-- Quarterly and annual prices are an explicit table rather than a computed discount, so
-- every total is a whole rupee amount that matches its Razorpay Plan exactly
-- (₹399 x 12 = ₹4,788, where 20% off ₹499 x 12 would be ₹4,790.40).
-- Each subscription now stores the price it was sold at, so renewals of subscriptions
-- created under the old ₹4,000 / ₹6,000 card keep validating against what they pay.
begin;
create function public.crm_plan_monthly_paise(selected_plan text, months integer) returns bigint
language sql immutable set search_path='' as $$
 select case selected_plan
  when 'pro' then case months when 1 then 49900 when 3 then 44900 when 12 then 39900 end
  when 'pro_plus' then case months when 1 then 69900 when 3 then 62900 when 12 then 55900 end
 end::bigint
$$;
create function public.crm_seat_monthly_paise() returns bigint language sql immutable set search_path='' as $$ select 19900::bigint $$;
revoke all on function public.crm_plan_monthly_paise(text,integer),public.crm_seat_monthly_paise() from public,anon,authenticated;

alter table public.crm_billing_subscriptions add column amount_paise bigint;
update public.crm_billing_subscriptions
 set amount_paise=(case plan when 'pro' then 400000 else 600000 end)*(case billing_months when 1 then 100 when 3 then 90 else 80 end)/100*billing_months;
alter table public.crm_billing_subscriptions alter column amount_paise set not null,
 add constraint crm_billing_subscriptions_amount_check check(amount_paise>0 and amount_paise%billing_months=0);

alter table public.crm_seat_subscriptions add column unit_paise bigint;
update public.crm_seat_subscriptions set unit_paise=50000;
alter table public.crm_seat_subscriptions alter column unit_paise set not null,
 add constraint crm_seat_subscriptions_unit_check check(unit_paise>0);

create or replace function public.crm_finish_checkout(attempt_id uuid, provider_id text, provider_plan text) returns void language plpgsql security definer set search_path='' as $$
declare a public.crm_checkout_attempts;
begin
 select * into a from public.crm_checkout_attempts where id=attempt_id for update;
 if not found then raise exception 'Checkout unavailable'; end if;
 if a.status='ready' and a.subscription_id=provider_id then return; end if;
 if a.status not in ('creating','unknown') then raise exception 'Checkout already finalized'; end if;
 if provider_id='' then update public.crm_checkout_attempts set status='closed' where id=a.id; return; end if;
 if provider_id is null then update public.crm_checkout_attempts set status='unknown' where id=a.id; return; end if;
 if a.kind='base' then
 insert into public.crm_billing_subscriptions(organization_id,razorpay_subscription_id,razorpay_plan_id,plan,billing_months,status,amount_paise) values(a.organization_id,provider_id,provider_plan,a.plan,a.months,'created',public.crm_plan_monthly_paise(a.plan,a.months)*a.months)
 on conflict(organization_id) do update set razorpay_subscription_id=excluded.razorpay_subscription_id,razorpay_plan_id=excluded.razorpay_plan_id,plan=excluded.plan,billing_months=excluded.billing_months,status='created',event_at=null,amount_paise=excluded.amount_paise;
 else insert into public.crm_seat_subscriptions(id,organization_id,plan_id,quantity,unit_paise) values(provider_id,a.organization_id,provider_plan,a.quantity,public.crm_seat_monthly_paise()); end if;
 update public.crm_checkout_attempts set status='ready',subscription_id=provider_id where id=a.id;
end $$;

create or replace function public.crm_apply_paid_event(event_key text, subscription_id text, provider_plan text, new_status text, occurred_at timestamptz, payment_id text, cycle_start timestamptz, cycle_end timestamptz, paid_amount bigint, currency text, overhead bigint, ai_allowance integer, whatsapp_allowance integer)
returns void language plpgsql security definer set search_path='' as $$
declare b public.crm_billing_subscriptions; seat public.crm_seat_subscriptions; org uuid; expected bigint; monthly bigint; period_start timestamptz; period_end timestamptz; i integer; previous uuid;
begin
 if event_key is null or new_status is null or new_status not in ('created','authenticated','active','pending','halted','paused','cancelled','completed','expired') or occurred_at is null then raise exception 'Invalid event'; end if;
 insert into public.crm_billing_webhook_events(id) values(event_key) on conflict do nothing;
 if not found and (payment_id is null or exists(select 1 from public.crm_paid_cycles c where c.payment_id=crm_apply_paid_event.payment_id)) then return; end if;
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
  expected:=b.amount_paise;
  monthly:=b.amount_paise/b.billing_months;
  if abs(extract(epoch from cycle_end-(cycle_start+make_interval(months=>b.billing_months))))>86400 then raise exception 'Billing duration mismatch'; end if;
 else expected:=seat.unit_paise*seat.quantity;
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
commit;
