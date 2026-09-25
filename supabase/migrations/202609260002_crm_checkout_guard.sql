-- Cancelling flips crm_billing_subscriptions.status to 'cancelled' immediately so the
-- customer keeps already-paid access until it naturally ends, but that same immediate
-- flip also unblocked crm_begin_checkout's "no existing subscription" check right away.
-- A customer who cancelled intending to upgrade could start a brand-new paid checkout
-- while their old, already-paid period was still running: the old Razorpay subscription
-- keeps billing toward its own cycle-end cancellation while a new one starts, and
-- crm_apply_paid_event's period-splitting truncates the still-valid old usage period to
-- make room for the new one, forfeiting the unused remainder. No proration, no warning.
-- Block a new base checkout while a real, currently-live paid period still exists,
-- independent of the Razorpay-side subscription status. This is a stopgap: it closes the
-- double-billing hole but does not add a real upgrade path (still no way to change plan
-- or billing period while subscribed; that remains a known, separate gap).
begin;
create or replace function public.crm_begin_checkout(checkout_kind text, selected_plan text, months integer, seats integer) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if exists(select 1 from public.crm_usage_periods where organization_id=org and trial_budget_paise is null and starts_at<=now() and ends_at>now())
  then raise exception 'You already have paid access through the end of your current billing period. Wait for it to end, or contact us to change plans early.'; end if;
 end if;
 select * into attempt from public.crm_checkout_attempts where organization_id=org and kind=checkout_kind and status in ('creating','unknown') order by created_at desc limit 1;
 if found then return jsonb_build_object('run',false,'status',attempt.status,'id',attempt.id); end if;
 insert into public.crm_checkout_attempts(organization_id,kind,plan,months,quantity) values(org,checkout_kind,selected_plan,months,seats) returning * into attempt;
 return jsonb_build_object('run',true,'id',attempt.id);
end $$;
commit;
