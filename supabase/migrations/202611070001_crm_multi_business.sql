-- One login, several businesses.
--
-- Until now a member's id WAS their auth user id, so a login could belong to exactly one
-- business. Memberships now get their own id and point at the login through user_id.
-- Existing memberships keep id = user_id, so every lead owner, task, activity, booking and
-- calendar connection that references a member stays valid untouched.
--
-- The business a request acts in comes from the x-crm-organization request header, which
-- the CRM server sets from the signed-in user's chosen workspace. crm_member_id() accepts
-- it only when the login really is a member there; without the header it falls back to the
-- login's earliest membership, which is exactly the old behaviour for single-business users.
begin;

alter table public.crm_members add column user_id uuid;
update public.crm_members set user_id = id;
alter table public.crm_members alter column user_id set not null,
 drop constraint crm_members_id_fkey,
 add constraint crm_members_user_fk foreign key (user_id) references auth.users(id) on delete cascade,
 add constraint crm_members_user_organization_key unique (user_id, organization_id);
create index crm_members_user_idx on public.crm_members(user_id, joined_at);
-- Inserts written before this change set only id; treat that as the login's own membership.
create function public.crm_member_default_user() returns trigger language plpgsql set search_path='' as $$
begin
 new.user_id := coalesce(new.user_id, new.id);
 return new;
end $$;
create trigger crm_member_default_user before insert on public.crm_members
 for each row execute function public.crm_member_default_user();

create function public.crm_member_id() returns uuid language sql stable security definer set search_path='' as $$
 with requested as (
  select nullif(current_setting('request.headers', true), '')::json ->> 'x-crm-organization' as org
 )
 select m.id from public.crm_members m, requested r
 where m.user_id = (select auth.uid())
   and (r.org is null
        or (r.org ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and m.organization_id = r.org::uuid))
 order by m.joined_at, m.id
 limit 1
$$;
revoke all on function public.crm_member_id() from public, anon;
grant execute on function public.crm_member_id() to authenticated, service_role;

-- The signed-in login's own memberships, for choosing a workspace. Readable across
-- businesses only for the caller's own rows; `active` mirrors crm_role()'s seat check.
create function public.crm_my_memberships()
returns table(member_id uuid, organization_id uuid, organization_name text, role text, active boolean)
language sql stable security definer set search_path='' as $$
 select m.id, m.organization_id, o.name, m.role, public.crm_member_seat_active(m.id)
 from public.crm_members m join public.crm_organizations o on o.id = m.organization_id
 where m.user_id = (select auth.uid())
 order by m.joined_at, m.id
$$;
revoke all on function public.crm_my_memberships() from public, anon;
grant execute on function public.crm_my_memberships() to authenticated;

-- Every function and policy that used the login id as "the current member" now uses the
-- membership id. Rewriting the deployed definitions (rather than copies from older
-- migrations) keeps whatever version is live and only swaps the identity lookup.
do $$
declare f record;
begin
 for f in
  select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname <> 'crm_member_id' and p.prosrc like '%auth.uid()%'
 loop
  execute replace(pg_get_functiondef(f.oid), 'auth.uid()', 'public.crm_member_id()');
 end loop;
end $$;

drop policy saved_views_own on public.crm_saved_views;
create policy saved_views_own on public.crm_saved_views for all to authenticated
 using (member_id = (select public.crm_member_id()))
 with check (member_id = (select public.crm_member_id()));

-- New businesses and accepted invitations create a membership row per business. The first
-- membership a login ever gets keeps id = user id; later ones get a fresh id.
create or replace function public.crm_provision_organization(owner_user uuid, organization_name text, owner_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 if owner_user is null or nullif(trim(organization_name),'') is null or nullif(trim(owner_name),'') is null then
  raise exception 'Owner and organisation details are required';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_user::text,2));
 -- Signup provisions one business per new login; a repeated call returns it.
 select organization_id into org from public.crm_members where user_id=owner_user and role='owner' order by joined_at limit 1;
 if org is not null then return org; end if;
 insert into public.crm_organizations(name) values(trim(organization_name)) returning id into org;
 insert into public.crm_members(id,user_id,organization_id,name,role)
 values(case when exists(select 1 from public.crm_members where id=owner_user) then gen_random_uuid() else owner_user end,
        owner_user,org,trim(owner_name),'owner');
 insert into public.crm_stages(organization_id,name,position,kind) values
  (org,'New enquiry',0,'open'),(org,'Contacted',1,'open'),(org,'Qualified',2,'open'),
  (org,'Site visit scheduled',3,'open'),(org,'Negotiation',4,'open'),(org,'Won',5,'won'),(org,'Lost',6,'lost');
 return org;
end $$;

create or replace function public.crm_accept_invitation(hashed_token text, verified_user uuid, member_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare invitation public.crm_invitations; verified_email text; existing uuid; inviter_role text;
begin
 select lower(email) into verified_email from auth.users where id=verified_user and email_confirmed_at is not null;
 if verified_email is null then raise exception 'Verified email required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(verified_user::text,2));
 select * into invitation from public.crm_invitations where token_hash=hashed_token for update;
 if not found or invitation.email<>verified_email then raise exception 'Invitation unavailable'; end if;
 select id into existing from public.crm_members where user_id=verified_user and organization_id=invitation.organization_id;
 if invitation.accepted_at is not null and existing is not null then return invitation.organization_id; end if;
 if invitation.accepted_at is not null or invitation.revoked_at is not null or invitation.expires_at<=now() then raise exception 'Invitation unavailable'; end if;
 select role into inviter_role from public.crm_members where id=invitation.invited_by and organization_id=invitation.organization_id;
 if inviter_role is null or inviter_role not in ('owner','admin') or (invitation.role='admin' and inviter_role<>'owner') then raise exception 'Invitation unavailable'; end if;
 -- Belonging to another business no longer blocks joining this one.
 if existing is null then
  insert into public.crm_members(id,user_id,organization_id,name,role)
  values(case when exists(select 1 from public.crm_members where id=verified_user) then gen_random_uuid() else verified_user end,
         verified_user,invitation.organization_id,trim(member_name),invitation.role);
 end if;
 -- Existing members keep their current role; a link never silently elevates it.
 update public.crm_invitations set accepted_at=now() where id=invitation.id;
 return invitation.organization_id;
end $$;
commit;
