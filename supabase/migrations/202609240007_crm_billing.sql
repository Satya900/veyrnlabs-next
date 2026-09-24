-- Razorpay checkout tracking and webhook-driven entitlement activation.
-- No live Razorpay call is made by this migration; it only adds server-side plumbing.
begin;
create table public.crm_billing_subscriptions (
 organization_id uuid primary key references public.crm_organizations(id),
 razorpay_subscription_id text not null unique check(length(razorpay_subscription_id) between 1 and 100),
 razorpay_plan_id text not null check(length(razorpay_plan_id) between 1 and 100),
 plan text not null check(plan in ('pro','pro_plus')),
 billing_months integer not null check(billing_months in (1,3,12)),
 status text not null default 'created'
  check(status in ('created','authenticated','active','pending','halted','cancelled','completed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
-- Dedupes webhook deliveries by a hash of the verified raw body, not a Razorpay-supplied id,
-- since the exact payload shape is only confirmed once this is exercised against real deliveries.
create table public.crm_billing_webhook_events (
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default now()
);
alter table public.crm_billing_subscriptions enable row level security;
alter table public.crm_billing_webhook_events enable row level security;
revoke all on public.crm_billing_subscriptions,public.crm_billing_webhook_events from public,anon,authenticated;
grant all on public.crm_billing_subscriptions,public.crm_billing_webhook_events to service_role;

-- The owner starts one checkout attempt per business. Plan changes and multiple concurrent
-- subscriptions are deliberately not supported yet; cancel or complete the existing one first.
create function public.crm_start_subscription(selected_plan text, months integer, subscription_id text, razorpay_plan text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); current_status text;
begin
 if org is null or public.crm_role()<>'owner' then raise exception 'Only the owner manages billing'; end if;
 if selected_plan not in ('pro','pro_plus') or months not in (1,3,12)
   or nullif(trim(subscription_id),'') is null or nullif(trim(razorpay_plan),'') is null
 then raise exception 'Invalid subscription request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text,5));
 select status into current_status from public.crm_billing_subscriptions where organization_id=org for update;
 if current_status is not null and current_status not in ('cancelled','completed') then
  raise exception 'A subscription already exists for this business';
 end if;
 insert into public.crm_billing_subscriptions(organization_id,razorpay_subscription_id,razorpay_plan_id,plan,billing_months,status)
 values(org,subscription_id,razorpay_plan,selected_plan,months,'created')
 on conflict(organization_id) do update set
  razorpay_subscription_id=excluded.razorpay_subscription_id,razorpay_plan_id=excluded.razorpay_plan_id,
  plan=excluded.plan,billing_months=excluded.billing_months,status='created',updated_at=now();
end $$;
revoke all on function public.crm_start_subscription(text,integer,text,text) from public,anon;
grant execute on function public.crm_start_subscription(text,integer,text,text) to authenticated;

-- Applies one verified webhook event exactly once. A duplicate event id is a silent no-op so
-- Razorpay retries are safe. Opening a period only happens for a genuine new charge; the operator
-- supplies overhead/allowances from reviewed rates, never invented here. Only the current month
-- is opened; renewing the following month(s) of a quarterly/annual subscription without a new
-- charge is not yet automated (see docs/crm-billing-rollout.md).
-- crm_open_usage_period computes revenue itself from plan and billing_months; only the
-- operator-reviewed overhead and allowances need to travel through this call.
create function public.crm_apply_billing_webhook(
 event_id text, subscription_id text, new_status text, open_period boolean,
 overhead bigint, ai_allowance integer, whatsapp_allowance integer
) returns void language plpgsql security definer set search_path='' as $$
declare sub public.crm_billing_subscriptions;
begin
 if event_id !~ '^[a-f0-9]{64}$' then raise exception 'Invalid webhook event'; end if;
 if new_status not in ('created','authenticated','active','pending','halted','cancelled','completed')
 then raise exception 'Invalid status'; end if;
 insert into public.crm_billing_webhook_events(id) values(event_id) on conflict(id) do nothing;
 if not found then return; end if;
 select * into sub from public.crm_billing_subscriptions where razorpay_subscription_id=subscription_id for update;
 if not found then raise exception 'Unknown subscription %', subscription_id; end if;
 update public.crm_billing_subscriptions set status=new_status,updated_at=now() where organization_id=sub.organization_id;
 if open_period then
  perform public.crm_open_usage_period(sub.organization_id,sub.plan,sub.billing_months,
   now(),now()+interval '1 month',overhead,ai_allowance,whatsapp_allowance,0);
 end if;
end $$;
revoke all on function public.crm_apply_billing_webhook(text,text,text,boolean,bigint,integer,integer) from public,anon,authenticated;
grant execute on function public.crm_apply_billing_webhook(text,text,text,boolean,bigint,integer,integer) to service_role;

-- Adds billing_status to the existing entitlement summary. Reproduces the trial branch from
-- 202609240003 unchanged; only the unconfigured/inactive/active branches gain billing_status.
create or replace function public.crm_usage_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid; s public.crm_subscriptions; p public.crm_usage_periods; b public.crm_billing_subscriptions;
 ai bigint; wa bigint; spent bigint; result jsonb;
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 org := public.crm_organization_id();
 select * into p from public.crm_usage_periods where organization_id=org and trial_budget_paise is not null order by starts_at desc limit 1;
 if found and not exists(select 1 from public.crm_subscriptions where organization_id=org and active) then
  select coalesce(sum(units) filter(where kind='ai'),0),coalesce(sum(units) filter(where kind='whatsapp'),0),coalesce(sum(case when status='settled' then actual_paise else reserved_paise end),0) into ai,wa,spent from public.crm_usage_events where period_id=p.id and status<>'cancelled';
  return jsonb_build_object('status',case when p.starts_at<=now() and p.ends_at>now() then 'active' else 'inactive' end,'trial',true,'period_end',p.ends_at,'ai_limit',p.ai_limit,'ai_used',ai,'whatsapp_limit',p.whatsapp_limit,'whatsapp_used',wa,'automation_paused',spent>=p.cost_ceiling_paise);
 end if;
 select * into b from public.crm_billing_subscriptions where organization_id=org;
 select * into s from public.crm_subscriptions where organization_id=org;
 if not found then return jsonb_build_object('status','unconfigured','billing_status',b.status); end if;
 result := jsonb_build_object('status','inactive','plan',s.plan,'billing_months',s.billing_months,
   'included_seats',case when s.plan='pro' then 1 else 3 end,'purchased_seats',s.purchased_seats,
   'member_count',(select count(*) from public.crm_members where organization_id=org),
   'automatic_scheduling',s.plan='pro_plus','billing_status',b.status);
 select * into p from public.crm_usage_periods where organization_id=org and starts_at<=now() and ends_at>now();
 if not found or not s.active then return result; end if;
 select coalesce(sum(units) filter(where kind='ai'),0),coalesce(sum(units) filter(where kind='whatsapp'),0),
   coalesce(sum(case when status='settled' then actual_paise else reserved_paise end),0)
 into ai,wa,spent from public.crm_usage_events where period_id=p.id and status<>'cancelled';
 return result || jsonb_build_object('status','active','period_end',p.ends_at,'ai_limit',p.ai_limit,'ai_used',ai,
   'whatsapp_limit',p.whatsapp_limit,'whatsapp_used',wa,'automation_paused',p.overhead_paise+spent>=p.cost_ceiling_paise);
end $$;
commit;
