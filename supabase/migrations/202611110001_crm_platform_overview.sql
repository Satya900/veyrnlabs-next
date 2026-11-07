-- Product-owner overview across every workspace, for the platform admin page.
-- Read-only. Only the server's service role can run it; the page itself also checks the
-- signed-in email against CRM_PLATFORM_ADMIN_EMAILS before calling it.
begin;

-- plpgsql (not sql) so auth.users is resolved when it runs rather than at creation.
create function public.crm_platform_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 return (
 with paid as (
  -- A workspace is paying while a non-trial usage period covers now.
  select distinct organization_id from public.crm_usage_periods
  where trial_budget_paise is null and starts_at<=now() and ends_at>now()
 ), mrr as (
  select b.organization_id, b.amount_paise/b.billing_months as monthly_paise
  from public.crm_billing_subscriptions b join paid p using (organization_id)
  where b.status='active'
 ), seats as (
  select s.organization_id, sum(s.unit_paise*s.quantity) as monthly_paise
  from public.crm_seat_subscriptions s
  where s.status='active' and exists(select 1 from public.crm_paid_cycles c
   where c.subscription_id=s.id and c.starts_at<=now() and c.ends_at>now())
  group by s.organization_id
 ), workspaces as (
  select
   o.id, o.name, o.created_at,
   owner_member.name as owner_name,
   owner_user.email as owner_email,
   (select count(*) from public.crm_members m where m.organization_id=o.id) as members,
   coalesce(sub.purchased_seats,0) as purchased_seats,
   sub.plan, sub.billing_months,
   (p.organization_id is not null) as paying,
   (select max(u.ends_at) from public.crm_usage_periods u where u.organization_id=o.id and u.trial_budget_paise is null) as paid_until,
   b.status as billing_status,
   coalesce(mrr.monthly_paise,0)+coalesce(seats.monthly_paise,0) as monthly_paise,
   (select count(*) from public.crm_leads l where l.organization_id=o.id) as leads,
   (select count(*) from public.crm_leads l where l.organization_id=o.id and l.created_at>now()-interval '7 days') as leads_7d,
   (select count(*) from public.crm_clients c where c.organization_id=o.id) as clients,
   w.provider as whatsapp_provider,
   coalesce(w.active,false) as whatsapp_active,
   (select count(*) from public.crm_whatsapp_messages msg where msg.organization_id=o.id and msg.sent_at>now()-interval '30 days') as messages_in_30d,
   (select count(*) from public.crm_whatsapp_outbox x where x.organization_id=o.id and x.status='accepted' and x.created_at>now()-interval '30 days') as messages_out_30d,
   (select count(*) from public.crm_whatsapp_followup_jobs j where j.organization_id=o.id and j.status='sent' and j.created_at>now()-interval '30 days') as followups_30d,
   greatest(
    (select max(a.created_at) from public.crm_activities a where a.organization_id=o.id),
    (select max(msg.sent_at) from public.crm_whatsapp_messages msg where msg.organization_id=o.id)
   ) as last_activity
  from public.crm_organizations o
  left join public.crm_members owner_member on owner_member.organization_id=o.id and owner_member.role='owner'
  left join auth.users owner_user on owner_user.id=owner_member.user_id
  left join public.crm_subscriptions sub on sub.organization_id=o.id
  left join paid p on p.organization_id=o.id
  left join public.crm_billing_subscriptions b on b.organization_id=o.id
  left join mrr on mrr.organization_id=o.id
  left join seats on seats.organization_id=o.id
  left join public.crm_whatsapp_connections w on w.organization_id=o.id
 )
 select jsonb_build_object(
  'generated_at', now(),
  'totals', jsonb_build_object(
   'workspaces', (select count(*) from workspaces),
   'new_30d', (select count(*) from workspaces where created_at>now()-interval '30 days'),
   'paying', (select count(*) from workspaces where paying),
   'mrr_paise', (select coalesce(sum(monthly_paise),0) from workspaces),
   'members', (select count(*) from public.crm_members),
   'leads', (select coalesce(sum(leads),0) from workspaces),
   'leads_7d', (select coalesce(sum(leads_7d),0) from workspaces),
   'whatsapp_connected', (select count(*) from workspaces where whatsapp_active),
   'messages_in_30d', (select coalesce(sum(messages_in_30d),0) from workspaces),
   'messages_out_30d', (select coalesce(sum(messages_out_30d),0) from workspaces),
   'followups_30d', (select coalesce(sum(followups_30d),0) from workspaces)
  ),
  'health', jsonb_build_object(
   'workers', coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'last_seen',h.last_seen,'last_success',h.last_success,'last_error',h.last_error) order by h.id) from public.crm_worker_health h), '[]'::jsonb),
   'billing_problems', (select count(*) from public.crm_billing_subscriptions where status in ('pending','halted')),
   'followups_need_attention', (select count(*) from public.crm_whatsapp_followup_jobs where status in ('failed','needs_human') and created_at>now()-interval '7 days'),
   'unconfirmed_messages', (select count(*) from public.crm_whatsapp_outbox where status in ('unknown','dispatching') and created_at<now()-interval '5 minutes')
  ),
  'workspaces', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at desc) from workspaces w), '[]'::jsonb)
 ));
end $$;
revoke all on function public.crm_platform_overview() from public, anon, authenticated;
grant execute on function public.crm_platform_overview() to service_role;
commit;
