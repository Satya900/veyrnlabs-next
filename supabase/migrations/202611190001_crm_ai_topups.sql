-- AI top-ups: a one-time Razorpay payment that adds AI actions to the current month's
-- allowance (they expire when it resets). The server records each order when checkout
-- starts and credits it exactly once, from the checkout callback or the order.paid webhook.
begin;

create table public.crm_ai_topups (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.crm_organizations(id),
 razorpay_order_id text not null unique check(razorpay_order_id ~ '^order_[A-Za-z0-9]+$'),
 razorpay_payment_id text unique,
 actions integer not null check(actions > 0),
 amount_paise bigint not null check(amount_paise > 0),
 status text not null default 'created' check(status in ('created','paid')),
 period_id uuid references public.crm_usage_periods(id),
 created_by uuid references public.crm_members(id),
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create index crm_ai_topups_org on public.crm_ai_topups(organization_id, created_at desc);
alter table public.crm_ai_topups enable row level security;
revoke all on public.crm_ai_topups from public, anon, authenticated;
grant select on public.crm_ai_topups to authenticated;
grant all on public.crm_ai_topups to service_role;
create policy ai_topups_admin on public.crm_ai_topups for select to authenticated
 using (organization_id = public.crm_organization_id() and coalesce(public.crm_role(),'') in ('owner','admin'));

-- Credits a captured payment to the workspace's current paid month: more AI actions, and the
-- same amount added to that month's revenue so the service budget grows with it. Repeating a
-- credit for the same order (callback and webhook both arrive) changes nothing.
create function public.crm_apply_ai_topup(order_id text, payment_id text, paid_amount bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.crm_ai_topups; p public.crm_usage_periods;
begin
 select * into t from public.crm_ai_topups where razorpay_order_id=order_id for update;
 if not found then raise exception 'Unknown top-up'; end if;
 if t.status='paid' then
  if t.razorpay_payment_id is distinct from payment_id then raise exception 'Top-up already paid by another payment'; end if;
  return jsonb_build_object('applied', false, 'actions', t.actions);
 end if;
 if paid_amount is distinct from t.amount_paise then raise exception 'Payment amount mismatch'; end if;
 select * into p from public.crm_usage_periods where organization_id=t.organization_id
  and trial_budget_paise is null and starts_at<=now() and ends_at>now() for update;
 if not found then raise exception 'No active paid month to add the top-up to'; end if;
 update public.crm_usage_periods set ai_limit=ai_limit+t.actions, revenue_paise=revenue_paise+t.amount_paise where id=p.id;
 update public.crm_ai_topups set status='paid', razorpay_payment_id=payment_id, period_id=p.id, paid_at=now() where id=t.id;
 return jsonb_build_object('applied', true, 'actions', t.actions, 'period_ends_at', p.ends_at);
end $$;
revoke all on function public.crm_apply_ai_topup(text,text,bigint) from public, anon, authenticated;
grant execute on function public.crm_apply_ai_topup(text,text,bigint) to service_role;

commit;
