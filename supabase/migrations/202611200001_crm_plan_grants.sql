-- Plans granted by the platform admin: Pro or Pro Plus for any period, without a payment
-- (partners, pilots, support credit, a customer who paid another way). A grant opens the same
-- monthly usage periods a payment does, so every feature, AI allowance and limit works as it
-- would for a paying workspace. Grants are recorded with who gave them and can be revoked.
-- Only the server's service role can run these; the admin page checks the signed-in email
-- against CRM_PLATFORM_ADMIN_EMAILS first.
begin;

create table public.crm_plan_grants (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.crm_organizations(id),
 plan text not null check(plan in ('pro','pro_plus')),
 starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at > starts_at),
 ai_limit integer not null check(ai_limit > 0),
 granted_by text not null check(length(granted_by) between 3 and 320),
 note text check(length(note) <= 500),
 created_at timestamptz not null default now(),
 revoked_at timestamptz,
 revoked_by text
);
create index crm_plan_grants_org on public.crm_plan_grants(organization_id, starts_at);
alter table public.crm_plan_grants enable row level security;
revoke all on public.crm_plan_grants from public, anon, authenticated;
grant all on public.crm_plan_grants to service_role;

-- Which grant opened a usage period (null for paid and trial periods).
alter table public.crm_usage_periods add column grant_id uuid references public.crm_plan_grants(id);

-- Grants grant_plan from starts to ends in monthly slices, each with the plan's own monthly
-- revenue as its service budget, monthly_ai AI actions and the plan's WhatsApp allowance.
-- A free trial running at the start is ended there. It refuses to overlap paid or granted
-- access (start it when that ends instead) and to switch plan while another plan is live.
create function public.crm_admin_grant_plan(org uuid, grant_plan text, starts timestamptz, ends timestamptz,
 monthly_ai integer, overhead bigint, whatsapp_allowance integer, admin_email text, grant_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 g public.crm_plan_grants; current_plan text; billing public.crm_billing_subscriptions;
 revenue bigint; slice_start timestamptz; slice_end timestamptz; i integer := 0; covered timestamptz;
begin
 if grant_plan is null or grant_plan not in ('pro','pro_plus') then raise exception 'Choose Pro or Pro Plus'; end if;
 if nullif(trim(admin_email),'') is null then raise exception 'Admin email required'; end if;
 starts := greatest(coalesce(starts, now()), now());
 if ends is null or ends <= starts + interval '1 hour' then raise exception 'The end date must be after the start date'; end if;
 if ends > starts + interval '3 years' then raise exception 'A grant can last at most 3 years'; end if;
 if monthly_ai is null or monthly_ai <= 0 or monthly_ai > 100000 then raise exception 'AI actions per month must be between 1 and 100000'; end if;
 revenue := case grant_plan when 'pro' then 49900 else 69900 end;
 if overhead is null or overhead <= 0 or overhead >= revenue*70/100 or whatsapp_allowance is null or whatsapp_allowance <= 0 then
  raise exception 'Invalid allowances';
 end if;
 perform 1 from public.crm_organizations where id=org for update;
 if not found then raise exception 'Workspace not found'; end if;

 select * into billing from public.crm_billing_subscriptions where organization_id=org;
 if billing.status in ('authenticated','active','pending','halted') and billing.plan<>grant_plan then
  raise exception 'This workspace pays for % through Razorpay. Grant the same plan, or cancel that subscription first',
   case billing.plan when 'pro' then 'Pro' else 'Pro Plus' end;
 end if;
 select plan into current_plan from public.crm_subscriptions where organization_id=org;
 if current_plan is distinct from grant_plan and exists(select 1 from public.crm_usage_periods where organization_id=org
   and trial_budget_paise is null and starts_at<=now() and ends_at>now()) then
  raise exception 'This workspace is on % right now. Grant the same plan, or revoke the current grant first',
   case current_plan when 'pro' then 'Pro' else 'Pro Plus' end;
 end if;
 select max(ends_at) into covered from public.crm_usage_periods where organization_id=org
  and trial_budget_paise is null and starts_at<ends and ends_at>starts;
 if covered is not null then
  raise exception 'This workspace already has a plan until % (IST). Start the grant on or after then',
   to_char(covered at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI');
 end if;
 -- A free trial gives way to the granted plan.
 update public.crm_usage_periods set ends_at=starts where organization_id=org and trial_budget_paise is not null
  and starts_at<starts and ends_at>starts;
 if exists(select 1 from public.crm_usage_periods where organization_id=org and starts_at<ends and ends_at>starts) then
  raise exception 'Overlapping usage period needs review';
 end if;

 insert into public.crm_subscriptions(organization_id,plan,billing_months,active) values(org,grant_plan,1,true)
 on conflict(organization_id) do update set plan=excluded.plan,active=true;
 insert into public.crm_plan_grants(organization_id,plan,starts_at,ends_at,ai_limit,granted_by,note)
 values(org,grant_plan,starts,ends,monthly_ai,lower(trim(admin_email)),nullif(trim(grant_note),'')) returning * into g;
 loop
  slice_start := starts + make_interval(months=>i);
  exit when slice_start >= ends;
  slice_end := least(starts + make_interval(months=>i+1), ends);
  insert into public.crm_usage_periods(organization_id,starts_at,ends_at,revenue_paise,overhead_paise,ai_limit,whatsapp_limit,grant_id)
  values(org,slice_start,slice_end,revenue,overhead,monthly_ai,whatsapp_allowance,g.id);
  i := i + 1;
 end loop;
 return to_jsonb(g) || jsonb_build_object('months', i);
end $$;
revoke all on function public.crm_admin_grant_plan(uuid,text,timestamptz,timestamptz,integer,bigint,integer,text,text) from public, anon, authenticated;
grant execute on function public.crm_admin_grant_plan(uuid,text,timestamptz,timestamptz,integer,bigint,integer,text,text) to service_role;

-- Ends a grant now: its future months are removed and the running month closes immediately.
-- Usage already spent stays on record.
create function public.crm_admin_revoke_grant(grant_id uuid, admin_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.crm_plan_grants;
begin
 if nullif(trim(admin_email),'') is null then raise exception 'Admin email required'; end if;
 select * into g from public.crm_plan_grants where id=grant_id for update;
 if not found then raise exception 'Grant not found'; end if;
 if g.revoked_at is not null then return to_jsonb(g); end if;
 delete from public.crm_usage_periods p where p.grant_id=g.id and p.starts_at>now()
  and not exists(select 1 from public.crm_usage_events e where e.period_id=p.id);
 update public.crm_usage_periods p set ends_at=greatest(now(), p.starts_at+interval '1 microsecond')
  where p.grant_id=g.id and p.ends_at>now();
 update public.crm_plan_grants set revoked_at=now(), revoked_by=lower(trim(admin_email)),
  ends_at=greatest(least(ends_at, now()), starts_at+interval '1 microsecond')
  where id=g.id returning * into g;
 return to_jsonb(g);
end $$;
revoke all on function public.crm_admin_revoke_grant(uuid,text) from public, anon, authenticated;
grant execute on function public.crm_admin_revoke_grant(uuid,text) to service_role;

-- The overview counts granted access separately from paying customers and lists each
-- workspace's current and upcoming grants. Patched in place; fails if it isn't the expected version.
do $$
declare def text;
 old_paid constant text := 'where trial_budget_paise is null and starts_at<=now() and ends_at>now()
 ), mrr as';
 old_status constant text := 'b.status as billing_status,';
begin
 select pg_get_functiondef('public.crm_platform_overview()'::regprocedure) into def;
 if position(old_paid in def) = 0 or position(old_status in def) = 0 then
  raise exception 'crm_platform_overview is not the expected version';
 end if;
 def := replace(def, old_paid, 'where trial_budget_paise is null and grant_id is null and starts_at<=now() and ends_at>now()
 ), mrr as');
 def := replace(def, old_status, 'b.status as billing_status,
   coalesce((select jsonb_agg(jsonb_build_object(''id'',g.id,''plan'',g.plan,''starts_at'',g.starts_at,''ends_at'',g.ends_at,
    ''ai_limit'',g.ai_limit,''granted_by'',g.granted_by,''note'',g.note) order by g.starts_at)
    from public.crm_plan_grants g where g.organization_id=o.id and g.revoked_at is null and g.ends_at>now()),''[]''::jsonb) as grants,');
 execute def;
end $$;

commit;
