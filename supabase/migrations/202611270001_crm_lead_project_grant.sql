-- Signed-in members could not tag a lead with a project: crm_leads grants insert and update
-- column by column, and project_id (added with Projects & brochures) was never granted.
-- The workspace-scoped foreign key still stops a lead pointing at another workspace's project.
begin;
grant insert(project_id), update(project_id) on public.crm_leads to authenticated;
commit;
