export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const target = new URL(request.url);
  // Next may normalize 127.0.0.1 to localhost in request.url in development.
  // Host preserves the authority the browser connected to; never trust a
  // client-supplied forwarded host for this CSRF check.
  target.host = request.headers.get("host") || target.host;
  return origin === target.origin;
}
