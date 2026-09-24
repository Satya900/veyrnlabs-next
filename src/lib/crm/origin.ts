export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  // Compare host only, not protocol. request.url reflects the connection between this
  // process and whatever sits in front of it (a TLS-terminating reverse proxy or, when
  // testing locally, an ngrok tunnel), which is commonly plain HTTP even though the
  // browser's own connection was HTTPS — that protocol can't be trusted here. Host still
  // reflects the authority the browser connected to and is never client-forgeable the
  // way X-Forwarded-Host would be.
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
