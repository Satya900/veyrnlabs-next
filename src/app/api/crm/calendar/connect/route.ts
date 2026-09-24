import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { session } from "@/lib/crm/server";
import { googleAuthorizeUrl, googleCalendarConfigured } from "@/lib/crm/google-calendar";

const STATE_COOKIE = "crm_calendar_oauth_state";

// Built from the Host header, not request.url: behind a TLS-terminating proxy or
// tunnel (ngrok), request.url reflects the plain-HTTP hop into this process (often
// localhost), which would redirect the browser off the public host it's actually on.
function siteUrl(request: Request, path: string) {
  return new URL(path, `https://${request.headers.get("host")}`);
}

function settingsUrl(request: Request, params: Record<string, string>) {
  const url = siteUrl(request, "/crm");
  url.searchParams.set("view", "settings");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export async function GET(request: Request) {
  if (!googleCalendarConfigured(process.env))
    return new Response("Calendar connection is not enabled yet.", { status: 503 });
  const auth = await session();
  if (!auth)
    return Response.redirect(siteUrl(request, "/crm/login"), 302);
  const { data } = await auth.db.rpc("crm_calendar_entitlement");
  const summary = data as { status?: string; plan?: string } | null;
  if (!(summary?.status === "active" && summary?.plan === "pro_plus"))
    return Response.redirect(
      settingsUrl(request, {
        calendar_error:
          "Automatic scheduling requires an active Pro Plus subscription.",
      }),
      302,
    );
  const host = request.headers.get("host");
  const redirectUri = `https://${host}/api/crm/calendar/callback`;
  const state = randomBytes(24).toString("hex");
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax, not strict: this cookie must survive the top-level redirect Google sends
    // the browser back with, which is a cross-site navigation from Google's origin.
    sameSite: "lax",
    path: "/api/crm/calendar",
    maxAge: 600,
  });
  return Response.redirect(googleAuthorizeUrl(process.env, redirectUri, state), 302);
}
