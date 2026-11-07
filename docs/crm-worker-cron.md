# CRM worker: Supabase Cron

The CRM's scheduled work runs in protected Vercel endpoints. Something has to call them on a
schedule. The primary caller is **Supabase Cron** (free, every minute). The GitHub Actions
workflow `.github/workflows/crm-worker.yml` is a backup only: GitHub delays scheduled runs on
quiet repositories by hours. Both can run at once; every job is claimed under a lock and is
never sent twice.

| Queue | Endpoint | Does |
|---|---|---|
| WhatsApp follow-ups | `POST /api/internal/crm/whatsapp-followups` | Sends due template follow-ups (a batch per call) |
| Email follow-ups | `POST /api/internal/crm/follow-ups` | AI-drafted follow-up emails (needs AI enabled) |
| AI auto-replies | `POST /api/internal/crm/auto-replies` | Automatic WhatsApp replies, up to 10 per call (needs AI and `CRM_AUTO_REPLIES_ENABLED=true`). The WhatsApp webhooks also start this worker about 7 seconds after each incoming message, so the cron run is the safety net. |

Each request needs `Authorization: Bearer <CRM_WORKER_SECRET>`, the same value as in Vercel.

## Setup (Supabase SQL editor)

1. **Extensions.** Database → Extensions: enable **pg_cron** and **pg_net**, or run:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   ```
2. **Store the worker secret in Vault.** Run this yourself with the real value; it is
   encrypted at rest and never appears in the job definition:
   ```sql
   select vault.create_secret('PASTE_CRM_WORKER_SECRET_HERE', 'crm_worker_secret');
   ```
3. **Schedule the WhatsApp follow-up queue every minute:**
   ```sql
   select cron.schedule(
     'crm-whatsapp-followups',
     '* * * * *',
     $$
     select net.http_post(
       url := 'https://crm.veyrnlabs.com/api/internal/crm/whatsapp-followups',
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_worker_secret'),
         'Content-Type', 'application/json'
       ),
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     );
     $$
   );
   ```
4. **Schedule automatic replies every minute** (the safety net behind the webhook kick):
   ```sql
   select cron.schedule(
     'crm-auto-replies',
     '* * * * *',
     $$
     select net.http_post(
       url := 'https://crm.veyrnlabs.com/api/internal/crm/auto-replies',
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_worker_secret'),
         'Content-Type', 'application/json'
       ),
       body := '{}'::jsonb,
       timeout_milliseconds := 90000
     );
     $$
   );
   ```
   When AI email follow-ups are switched on, schedule `follow-ups` the same way
   with their own job names.

## Checking it

```sql
-- Last runs and whether they succeeded
select jobname, status, return_message, start_time
from cron.job_run_details d join cron.job j using (jobid)
order by start_time desc limit 10;

-- HTTP responses from the CRM (200 with {"status":"idle"} when nothing is due)
select status_code, content, created from net._http_response order by created desc limit 10;

-- Worker heartbeat recorded by the CRM
select * from crm_worker_health;
```

To stop it: `select cron.unschedule('crm-whatsapp-followups');`
To rotate the secret: update it in Vercel and run
`select vault.update_secret((select id from vault.secrets where name='crm_worker_secret'), 'NEW_VALUE');`
