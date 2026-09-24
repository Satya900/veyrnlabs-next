begin;
-- Trial spend is an operator-funded allowance, never subscription revenue.
alter table public.crm_usage_periods drop constraint crm_usage_periods_organization_id_fkey;
alter table public.crm_usage_periods add foreign key(organization_id) references public.crm_organizations(id);
alter table public.crm_usage_periods add column trial_budget_paise bigint;
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.crm_usage_periods'::regclass and contype='c' loop
 execute format('alter table public.crm_usage_periods drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.crm_usage_periods drop column cost_ceiling_paise;
alter table public.crm_usage_periods add column cost_ceiling_paise bigint generated always as (coalesce(trial_budget_paise,revenue_paise*70/100)) stored;
alter table public.crm_usage_periods add check(ends_at>starts_at), add check(ai_limit>0),
 add check((trial_budget_paise is null and revenue_paise>0 and overhead_paise>0 and whatsapp_limit>0 and overhead_paise<revenue_paise*70/100)
 or (trial_budget_paise is not null and trial_budget_paise between 1 and 10000 and revenue_paise=0 and overhead_paise=0 and whatsapp_limit=0 and ai_limit<=25 and ends_at<=starts_at+interval '7 days'));
create function public.crm_open_ai_trial(org uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform 1 from public.crm_organizations where id=org for update;
 if not found then raise exception 'Unknown organization'; end if;
 select id into result from public.crm_usage_periods where organization_id=org and trial_budget_paise is not null;
 if found then return result; end if;
 if exists(select 1 from public.crm_subscriptions where organization_id=org and active) or exists(select 1 from public.crm_usage_periods where organization_id=org and ends_at>now()) then raise exception 'Existing entitlement must be preserved'; end if;
 insert into public.crm_usage_periods(organization_id,starts_at,ends_at,revenue_paise,overhead_paise,ai_limit,whatsapp_limit,trial_budget_paise)
 values(org,now(),now()+interval '7 days',0,0,25,0,10000) returning id into result;
 return result;
end $$;
revoke all on function public.crm_open_ai_trial(uuid) from public,anon,authenticated;
grant execute on function public.crm_open_ai_trial(uuid) to service_role;
create or replace function public.crm_reserve_usage(org uuid, request_key text, usage_kind text, quantity integer, max_cost_paise bigint)
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
 if p.trial_budget_paise is not null and usage_kind<>'ai' then raise exception 'Trial permits AI drafts only'; end if;
 if p.trial_budget_paise is null and not exists(select 1 from public.crm_subscriptions where organization_id=org and active)
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

create or replace function public.crm_usage_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid; s public.crm_subscriptions; p public.crm_usage_periods; ai bigint; wa bigint; spent bigint; result jsonb;
begin
 if coalesce(public.crm_role(),'') not in ('owner','admin') then raise exception 'Admin access required'; end if;
 org := public.crm_organization_id();
 select * into p from public.crm_usage_periods where organization_id=org and trial_budget_paise is not null order by starts_at desc limit 1;
 if found and not exists(select 1 from public.crm_subscriptions where organization_id=org and active) then
 select coalesce(sum(units),0),coalesce(sum(case when status='settled' then actual_paise else reserved_paise end),0) into ai,spent from public.crm_usage_events where period_id=p.id and status<>'cancelled';
 return jsonb_build_object('status',case when p.starts_at<=now() and p.ends_at>now() then 'active' else 'inactive' end,'trial',true,'period_end',p.ends_at,'ai_limit',p.ai_limit,'ai_used',ai,'whatsapp_limit',0,'whatsapp_used',0,'automation_paused',spent>=p.cost_ceiling_paise);
 end if;
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


commit;
