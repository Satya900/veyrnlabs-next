begin;
create table public.crm_invitations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.crm_organizations(id),
 invited_by uuid not null,
 email text not null check(length(email) between 3 and 254 and email=lower(trim(email))),
 role text not null check(role in ('admin','team')),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 accepted_at timestamptz,
 revoked_at timestamptz,
 foreign key(organization_id,invited_by) references public.crm_members(organization_id,id)
);
create index crm_invitations_org on public.crm_invitations(organization_id);
alter table public.crm_invitations enable row level security;
revoke all on public.crm_invitations from public,anon,authenticated;
grant select(id,organization_id,email,role,created_at,expires_at,accepted_at,revoked_at) on public.crm_invitations to authenticated;
grant all on public.crm_invitations to service_role;
create policy invitation_directory on public.crm_invitations for select to authenticated using(
 organization_id=public.crm_organization_id() and public.crm_role() in ('owner','admin'));

create function public.crm_create_invitation(invite_email text,invite_role text,hashed_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid:=public.crm_organization_id(); actor_role text:=public.crm_role(); result uuid;
begin
 if org is null or actor_role not in ('owner','admin') or actor_role is null then raise exception 'Invitation unavailable'; end if;
 if invite_role not in ('admin','team') or invite_role is null or (actor_role='admin' and invite_role<>'team') then raise exception 'Role not permitted'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text,3));
 if (select count(*) from public.crm_invitations where organization_id=org and created_at>now()-interval '1 hour')>=50 then raise exception 'Invitation limit reached'; end if;
 -- A replacement link invalidates earlier pending links for this email in this business.
 update public.crm_invitations set revoked_at=now() where organization_id=org and email=lower(trim(invite_email)) and accepted_at is null and revoked_at is null;
 insert into public.crm_invitations(organization_id,invited_by,email,role,token_hash)
 values(org,auth.uid(),lower(trim(invite_email)),invite_role,hashed_token) returning id into result;
 return result;
end $$;

create function public.crm_revoke_invitation(invitation uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if public.crm_role() is null or public.crm_role() not in ('owner','admin') then raise exception 'Invitation unavailable'; end if;
 update public.crm_invitations set revoked_at=now() where id=invitation and organization_id=public.crm_organization_id() and accepted_at is null;
end $$;

-- Only the server can call this after validating the authenticated user's identity.
create function public.crm_accept_invitation(hashed_token text,verified_user uuid,member_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare invitation public.crm_invitations; verified_email text; existing_org uuid; inviter_role text;
begin
 select lower(email) into verified_email from auth.users where id=verified_user and email_confirmed_at is not null;
 if verified_email is null then raise exception 'Verified email required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(verified_user::text,2));
 select * into invitation from public.crm_invitations where token_hash=hashed_token for update;
 if not found or invitation.email<>verified_email then raise exception 'Invitation unavailable'; end if;
 select organization_id into existing_org from public.crm_members where id=verified_user;
 if invitation.accepted_at is not null and existing_org=invitation.organization_id then return existing_org; end if;
 if invitation.accepted_at is not null or invitation.revoked_at is not null or invitation.expires_at<=now() then raise exception 'Invitation unavailable'; end if;
 select role into inviter_role from public.crm_members where id=invitation.invited_by and organization_id=invitation.organization_id;
 if inviter_role is null or inviter_role not in ('owner','admin') or (invitation.role='admin' and inviter_role<>'owner') then raise exception 'Invitation unavailable'; end if;
 if existing_org is not null and existing_org<>invitation.organization_id then raise exception 'Account already belongs to another business'; end if;
 if existing_org is null then
  insert into public.crm_members(id,organization_id,name,role) values(verified_user,invitation.organization_id,trim(member_name),invitation.role);
 end if;
 -- Existing members keep their current role; a link never silently elevates it.
 update public.crm_invitations set accepted_at=now() where id=invitation.id;
 return invitation.organization_id;
end $$;
revoke all on function public.crm_create_invitation(text,text,text),public.crm_revoke_invitation(uuid),public.crm_accept_invitation(text,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_create_invitation(text,text,text),public.crm_revoke_invitation(uuid) to authenticated;
grant execute on function public.crm_accept_invitation(text,uuid,text) to service_role;
commit;
