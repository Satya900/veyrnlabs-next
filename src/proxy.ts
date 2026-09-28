import { NextRequest, NextResponse } from "next/server";
import { isCrmHostname } from "@/lib/site";

// Both deployments use this repository. Only the CRM deployment sets CRM_HOST.
// Host rewriting chooses the page; authentication and RLS enforce data access.
export function proxy(request: NextRequest) {
  const isCrmHost = isCrmHostname(request.nextUrl.hostname);
  if (isCrmHost && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/crm";
    const response = NextResponse.rewrite(url);
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }
  const response = NextResponse.next();
  if (
    isCrmHost ||
    request.nextUrl.pathname.startsWith("/crm") ||
    request.nextUrl.pathname.startsWith("/api/crm")
  )
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
