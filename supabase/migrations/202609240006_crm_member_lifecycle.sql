-- Self-service ownership transfer and member removal. No email or billing change.
begin;
create unique index crm_members_single_owner on public.crm_members(organization_id) where role='owner';

-- Demotes the current owner to admin and promotes an existing member atomically.
-- Never a moment with two owners or, once complete, zero owners in the business.
create function public.crm_transfer_ownership(new_owner uuid) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); actor uuid:=(select auth.uid());
begin
 if org is null or public.crm_role()<>'owner' then raise exception 'Only the current owner can transfer ownership'; end if;
 if new_owner is null or new_owner=actor then raise exception 'Choose a different member to become the owner'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text,4));
 if not exists(select 1 from public.crm_members where id=new_owner and organization_id=org) then
  raise exception 'That member does not belong to this business';
 end if;
 update public.crm_members set role='admin' where id=actor and organization_id=org;
 update public.crm_members set role='owner' where id=new_owner and organization_id=org;
end $$;

-- Owners remove admins/team; admins remove team only; a member may remove their own
-- non-owner membership. The owner cannot be removed here; transfer ownership first.
-- Records the member owned stay, unassigned rather than deleted, so history survives.
create function public.crm_remove_member(target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); actor uuid:=(select auth.uid());
 actor_role text:=public.crm_role(); target_role text;
begin
 if org is null or actor_role is null then raise exception 'Membership unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text,4));
 select role into target_role from public.crm_members where id=target and organization_id=org;
 if target_role is null then raise exception 'That member does not belong to this business'; end if;
 if target_role='owner' then raise exception 'Transfer ownership before removing the owner'; end if;
 if target<>actor then
  if actor_role not in ('owner','admin') then raise exception 'Only owners and admins remove members'; end if;
  if actor_role='admin' and target_role<>'team' then raise exception 'Admins can only remove team members'; end if;
 end if;
 update public.crm_leads set owner_id=null where organization_id=org and owner_id=target;
 update public.crm_clients set owner_id=null where organization_id=org and owner_id=target;
 delete from public.crm_members where id=target and organization_id=org;
end $$;

revoke all on function public.crm_transfer_ownership(uuid),public.crm_remove_member(uuid) from public,anon;
grant execute on function public.crm_transfer_ownership(uuid),public.crm_remove_member(uuid) to authenticated;
commit;
