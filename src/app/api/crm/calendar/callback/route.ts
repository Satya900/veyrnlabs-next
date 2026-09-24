import { cookies } from "next/headers";
import { session } from "@/lib/crm/server";
import { encryptCalendarToken } from "@/lib/crm/calendar-crypto";
import { exchangeCode, googleCalendarConfigured } from "@/lib/crm/google-calendar";

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
  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!googleCalendarConfigured(process.env))
    return new Response("Calendar connection is not enabled yet.", { status: 503 });
  const auth = await session();
  if (!auth)
    return Response.redirect(siteUrl(request, "/crm/login"), 302);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error)
    return Response.redirect(
      settingsUrl(request, { calendar_error: "Google sign-in was cancelled or denied." }),
      302,
    );
  if (!code || !state || !expectedState || state !== expectedState)
    return Response.redirect(
      settingsUrl(request, { calendar_error: "This connection link expired. Try again." }),
      302,
    );

  try {
    const host = request.headers.get("host");
    const redirectUri = `https://${host}/api/crm/calendar/callback`;
    const tokens = await exchangeCode(process.env, code, redirectUri);
    if (!tokens.refresh_token)
      throw new Error(
        "Google did not grant offline access. Remove Veyrn CRM from your Google Account's third-party access and try connecting again.",
      );
    const encrypted = encryptCalendarToken(process.env, tokens.refresh_token);
    const { error: saveError } = await auth.db.rpc("crm_save_calendar_connection", {
      new_calendar_id: "primary",
      refresh_token_encrypted: encrypted,
    });
    if (saveError) throw new Error(saveError.message || "Could not save the connection.");
  } catch (err) {
    return Response.redirect(
      settingsUrl(request, {
        calendar_error:
          err instanceof Error ? err.message : "Could not connect your calendar.",
      }),
      302,
    );
  }
  return Response.redirect(settingsUrl(request, { calendar: "connected" }), 302);
}
