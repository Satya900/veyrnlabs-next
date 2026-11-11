-- Projects & brochures: a workspace lists its projects (location, status, possession, RERA),
-- each with unit types (2BHK, 3BHK…) carrying size, price range and availability, plus files
-- (brochures, floor plans, price sheets, photos) that agents send on WhatsApp in one tap.
-- Leads can be tagged with the project they're interested in, and the AI answers from this
-- live inventory: it is appended to the company knowledge every AI reply, draft and
-- follow-up email reads.
begin;

create table public.crm_projects (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.crm_organizations(id),
 name text not null check (length(trim(name)) between 1 and 120),
 location text not null default '' check (length(location) <= 200),
 developer text not null default '' check (length(developer) <= 120),
 status text not null default 'launched' check (status in ('upcoming','launched','under_construction','ready','sold_out')),
 possession text not null default '' check (length(possession) <= 60),
 rera text not null default '' check (length(rera) <= 80),
 description text not null default '' check (length(description) <= 3000),
 amenities text not null default '' check (length(amenities) <= 1000),
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id, id)
);
create table public.crm_project_units (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 name text not null check (length(trim(name)) between 1 and 60),
 size text not null default '' check (length(size) <= 60),
 price_min bigint check (price_min between 1 and 1000000000000),
 price_max bigint check (price_max between 1 and 1000000000000),
 availability text not null default 'available' check (availability in ('available','few_left','sold_out')),
 position integer not null default 0,
 created_at timestamptz not null default now(),
 check (price_max is null or price_min is null or price_max >= price_min),
 foreign key (organization_id, project_id) references public.crm_projects(organization_id, id) on delete cascade
);
create table public.crm_project_files (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 kind text not null default 'brochure' check (kind in ('brochure','floor_plan','price_sheet','photo','other')),
 name text not null check (length(trim(name)) between 1 and 120),
 storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,200}$'),
 mime text not null check (mime in ('application/pdf','image/jpeg','image/png','image/webp')),
 size_bytes integer not null check (size_bytes between 1 and 15728640),
 created_at timestamptz not null default now(),
 foreign key (organization_id, project_id) references public.crm_projects(organization_id, id) on delete cascade
);
create index crm_projects_org on public.crm_projects(organization_id, archived, name);
create index crm_project_units_project on public.crm_project_units(project_id, position);
create index crm_project_files_project on public.crm_project_files(project_id, created_at);

alter table public.crm_leads add column project_id uuid;
alter table public.crm_leads add constraint crm_leads_project
 foreign key (organization_id, project_id) references public.crm_projects(organization_id, id) on delete set null (project_id);
create index crm_leads_project on public.crm_leads(project_id) where project_id is not null;

alter table public.crm_projects enable row level security;
alter table public.crm_project_units enable row level security;
alter table public.crm_project_files enable row level security;
revoke all on public.crm_projects, public.crm_project_units, public.crm_project_files from public, anon, authenticated;
-- Everyone in the workspace reads inventory (agents send brochures); owners and admins edit it
-- through the server, which writes with the service role scoped to their workspace.
grant select on public.crm_projects, public.crm_project_units, public.crm_project_files to authenticated;
grant all on public.crm_projects, public.crm_project_units, public.crm_project_files to service_role;
create policy projects_members on public.crm_projects for select to authenticated
 using (organization_id = public.crm_organization_id());
create policy project_units_members on public.crm_project_units for select to authenticated
 using (organization_id = public.crm_organization_id());
create policy project_files_members on public.crm_project_files for select to authenticated
 using (organization_id = public.crm_organization_id());

-- Files live in a public bucket under unguessable paths (workspace/project/random-name), so
-- WhatsApp can fetch a brochure by its link. Uploads go through short-lived signed URLs the
-- server issues to owners and admins. Skipped where Supabase Storage isn't installed (tests).
do $$
begin
 if exists (select 1 from information_schema.tables where table_schema='storage' and table_name='buckets') then
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values('crm-files', 'crm-files', true, 15728640, array['application/pdf','image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public=true, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
 end if;
end $$;

-- 4500000 -> "45 L", 12500000 -> "1.25 Cr", 85000 -> "85,000".
create function public.crm_inr_short(amount bigint) returns text
language sql immutable set search_path='' as $$
 select case
  when amount >= 10000000 then trim(trailing '.' from trim(trailing '0' from to_char(amount / 10000000.0, 'FM999999990.00'))) || ' Cr'
  when amount >= 100000 then trim(trailing '.' from trim(trailing '0' from to_char(amount / 100000.0, 'FM999990.00'))) || ' L'
  else to_char(amount, 'FM999,999') end
$$;
-- The workspace's live inventory as plain text for the AI (at most ~7,500 characters):
-- active projects first by name, each with its unit types, sizes, price ranges and availability.
create function public.crm_inventory_text(org uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(left(
  E'\n\nPROJECTS AND AVAILABILITY (live from the CRM; when this differs from the text above, this is correct. Prices in INR):\n'
  || string_agg(project_text, E'\n' order by sold_out, name), 7500), '')
 from (
  select p.name, p.status='sold_out' as sold_out,
   '- ' || p.name
   || coalesce(nullif(', ' || p.location, ', '), '')
   || ' [' || replace(p.status, '_', ' ') || ']'
   || coalesce(nullif(' Possession: ' || p.possession || '.', ' Possession: .'), '')
   || coalesce(nullif(' Developer: ' || p.developer || '.', ' Developer: .'), '')
   || coalesce(nullif(' RERA: ' || p.rera || '.', ' RERA: .'), '')
   || coalesce(nullif(' ' || left(p.description, 400), ' '), '')
   || coalesce(nullif(' Amenities: ' || left(p.amenities, 200) || '.', ' Amenities: .'), '')
   || coalesce((select ' Units: ' || string_agg(
      u.name || coalesce(' ' || nullif(u.size, ''), '')
      || case
          when u.price_min is not null and u.price_max is not null and u.price_max > u.price_min
           then ' ₹' || public.crm_inr_short(u.price_min) || '–' || public.crm_inr_short(u.price_max)
          when coalesce(u.price_min, u.price_max) is not null then ' ₹' || public.crm_inr_short(coalesce(u.price_min, u.price_max))
          else ' price on request' end
      || ' (' || replace(u.availability, '_', ' ') || ')', '; ' order by u.position, u.name) || '.'
     from public.crm_project_units u where u.project_id = p.id), '')
   || case when exists(select 1 from public.crm_project_files f where f.project_id = p.id and f.kind = 'brochure')
      then ' Brochure available: the agent can share it on WhatsApp.' else '' end as project_text
  from public.crm_projects p
  where p.organization_id = org and not p.archived
 ) x
$$;
revoke all on function public.crm_inventory_text(uuid), public.crm_inr_short(bigint) from public, anon, authenticated;
grant execute on function public.crm_inventory_text(uuid) to service_role;

-- Every AI reply, draft and follow-up email reads the company knowledge from these two
-- functions; append the live inventory there. Patched in place; fails if not the expected version.
do $$
declare def text;
begin
 select pg_get_functiondef('public.crm_start_ai_draft_before_seats(uuid,uuid,text,bigint)'::regprocedure) into def;
 if position('''knowledge'',s.knowledge,' in def) = 0 then raise exception 'crm_start_ai_draft_before_seats is not the expected version'; end if;
 execute replace(def, '''knowledge'',s.knowledge,', '''knowledge'',s.knowledge||public.crm_inventory_text(s.organization_id),');

 select pg_get_functiondef('public.crm_claim_followup(bigint)'::regprocedure) into def;
 if position('''knowledge'',settings.knowledge,' in def) = 0 then raise exception 'crm_claim_followup is not the expected version'; end if;
 execute replace(def, '''knowledge'',settings.knowledge,', '''knowledge'',settings.knowledge||public.crm_inventory_text(settings.organization_id),');
end $$;

commit;
