/**
 * How stale a worker's `last_seen` can be before it's reported unhealthy. The GitHub Actions
 * cron polls every 5 minutes, and schedule-triggered runs can lag behind that on GitHub's side;
 * a 2-minute window flags a functioning worker as unhealthy for most of its normal cycle.
 */
export function workerHealthWindow(env: Record<string, string | undefined>) {
  const configured = Number(env.CRM_WORKER_HEALTH_WINDOW_MS);
  if (
    Number.isSafeInteger(configured) &&
    configured >= 60_000 &&
    configured <= 3_600_000
  )
    return configured;
  return 8 * 60_000;
}
