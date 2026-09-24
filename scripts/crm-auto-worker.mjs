import env from "@next/env";
env.loadEnvConfig(process.cwd());
const key = process.env.CRM_WORKER_SECRET;
if (!key || key.length < 32)
  throw new Error("Configure the worker secret first.");
const base = new URL(
  process.env.CRM_WORKER_BASE_URL || "http://127.0.0.1:3001",
);
if (
  base.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(base.hostname)
)
  throw new Error("Remote worker requests require HTTPS.");
const url = new URL("/api/internal/crm/auto-replies", base);
let stopping = false,
  failures = 0;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
do {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(130000),
      redirect: "error",
    });
    const result = await response.json();
    if (!response.ok) throw new Error("Worker request failed");
    failures = 0;
    if (result.status !== "idle")
      console.log(new Date().toISOString(), result.status || "processed");
  } catch {
    failures++;
    console.error(
      new Date().toISOString(),
      "Worker unavailable; attempt outcomes remain saved for review.",
    );
    // A managed host restarts and alerts on failure. Never silently run an unhealthy loop forever.
    if (failures >= 5) process.exitCode = 1;
  }
  if (!process.argv.includes("--watch") || failures >= 5) break;
  if (!stopping)
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(30000, 3000 * 2 ** failures)),
    );
} while (!stopping);
