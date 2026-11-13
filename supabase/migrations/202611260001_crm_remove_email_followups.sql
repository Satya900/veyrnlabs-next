-- Email follow-ups are removed: for real estate agents WhatsApp is the follow-up channel
-- (template follow-ups and AI replies). The app no longer has the setting, the worker or the
-- sender; this switches the feature off everywhere and keeps past jobs as history.
begin;

update public.crm_ai_settings
 set followup_enabled=false, followup_actor=null
 where followup_enabled or followup_actor is not null;

update public.crm_followup_jobs
 set status='skipped', reason='Email follow-ups were removed; WhatsApp is the follow-up channel.'
 where status='processing';

-- Nobody can switch it back on.
revoke execute on function public.crm_set_followups(boolean) from authenticated;

-- Its worker no longer runs, so it would show as stale in the admin health list.
delete from public.crm_worker_health where id='followups';

-- Stop any Supabase Cron job still calling the removed endpoint (skipped where cron isn't installed).
do $$
begin
 if exists (select 1 from information_schema.tables where table_schema='cron' and table_name='job') then
  execute $q$select cron.unschedule(jobid) from cron.job where command like '%/api/internal/crm/follow-ups%'$q$;
 end if;
end $$;

commit;
