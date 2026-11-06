-- Team lead visibility, chosen per workspace by its owner.
--
-- "All leads" (the default): team members see every lead, client, task, activity and
-- WhatsApp conversation in the workspace, can add notes and tasks, move stages and claim
-- unassigned leads. "Assigned only": the previous behaviour, where a team member sees only
-- leads assigned to them.
--
-- Either way, contacting or booking a client (WhatsApp replies, AI drafts, site visits)
-- stays with the lead's assigned agent and owners/admins: those functions check the actor
-- against the lead owner themselves and are unchanged. Only owners and admins reassign a
-- lead to someone else.
begin;

alter table public.crm_organizations
 add column team_sees_all_leads boolean not null default true;

create function public.crm_can_view(assigned uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(
  public.crm_access(assigned)
  or (public.crm_role() = 'team'
      and (select o.team_sees_all_leads from public.crm_organizations o
           where o.id = public.crm_organization_id())),
  false)
$$;
create function public.crm_lead_view(lead uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.crm_leads
  where id = lead and organization_id = public.crm_organization_id()
    and public.crm_can_view(owner_id))
$$;
revoke all on function public.crm_can_view(uuid), public.crm_lead_view(uuid) from public, anon;
grant execute on function public.crm_can_view(uuid), public.crm_lead_view(uuid) to authenticated;

drop policy leads_read on public.crm_leads;
create policy leads_read on public.crm_leads for select to authenticated
 using (public.crm_can_view(owner_id));
drop policy leads_update on public.crm_leads;
create policy leads_update on public.crm_leads for update to authenticated
 using (public.crm_can_view(owner_id)) with check (public.crm_can_view(owner_id));

drop policy clients_read on public.crm_clients;
create policy clients_read on public.crm_clients for select to authenticated
 using (public.crm_can_view(owner_id) or exists(
  select 1 from public.crm_leads l where l.client_id = crm_clients.id and public.crm_can_view(l.owner_id)));

drop policy tasks_read on public.crm_tasks;
create policy tasks_read on public.crm_tasks for select to authenticated using (public.crm_lead_view(lead_id));
drop policy tasks_insert on public.crm_tasks;
create policy tasks_insert on public.crm_tasks for insert to authenticated with check (public.crm_lead_view(lead_id));
drop policy tasks_update on public.crm_tasks;
create policy tasks_update on public.crm_tasks for update to authenticated
 using (public.crm_lead_view(lead_id)) with check (public.crm_lead_view(lead_id));

drop policy activity_read on public.crm_activities;
create policy activity_read on public.crm_activities for select to authenticated using (public.crm_lead_view(lead_id));
drop policy activity_insert on public.crm_activities;
create policy activity_insert on public.crm_activities for insert to authenticated
 with check (public.crm_lead_view(lead_id) and kind in ('note','call','meeting'));

-- Messages, AI drafts and the outbox follow conversation visibility through their own policies.
drop policy whatsapp_conversation_access on public.crm_whatsapp_conversations;
create policy whatsapp_conversation_access on public.crm_whatsapp_conversations for select to authenticated
 using (organization_id = public.crm_organization_id() and public.crm_lead_view(lead_id));

-- Seeing (and editing) a colleague's lead is not permission to take it: a team member may
-- only assign an unassigned lead to themselves. Owners and admins reassign freely.
create function public.crm_lead_assignment_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.owner_id is distinct from old.owner_id
    and public.crm_role() = 'team'
    and not (old.owner_id is null and new.owner_id = public.crm_member_id())
 then raise exception 'Only owners and admins can reassign leads' using errcode = 'P0001';
 end if;
 return new;
end $$;
create trigger crm_lead_assignment_guard before update of owner_id on public.crm_leads
 for each row execute function public.crm_lead_assignment_guard();

create function public.crm_set_team_visibility(all_leads boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if public.crm_role() is distinct from 'owner' then
  raise exception 'Only the workspace owner changes lead visibility' using errcode = 'P0001';
 end if;
 if all_leads is null then raise exception 'Choose a visibility setting' using errcode = 'P0001'; end if;
 update public.crm_organizations set team_sees_all_leads = all_leads where id = public.crm_organization_id();
end $$;
revoke all on function public.crm_set_team_visibility(boolean) from public, anon;
grant execute on function public.crm_set_team_visibility(boolean) to authenticated;
commit;
