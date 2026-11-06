-- 202611070001 rewrote every function containing auth.uid() to use the membership id,
-- including crm_my_memberships, whose filter must match the login. That only worked while
-- a login's original membership (id = login id) existed; once it was removed, the login's
-- other businesses would disappear from the switcher and sign-in. Restore the login filter.
begin;
create or replace function public.crm_my_memberships()
returns table(member_id uuid, organization_id uuid, organization_name text, role text, active boolean)
language sql stable security definer set search_path='' as $$
 select m.id, m.organization_id, o.name, m.role, public.crm_member_seat_active(m.id)
 from public.crm_members m join public.crm_organizations o on o.id = m.organization_id
 where m.user_id = (select auth.uid())
 order by m.joined_at, m.id
$$;
commit;
