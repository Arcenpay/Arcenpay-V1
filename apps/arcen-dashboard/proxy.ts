// ============================================================
//  Dashboard — Next.js Proxy (route protection)
//  Protects all routes except login and auth API endpoints.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySession } from "./lib/auth";

// Paths that don't require authentication
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/nonce",
  "/api/auth/verify",
  "/api/auth/logout",
  "/api/auth/magic", // magic link request + verify
  "/api/subscriber/lookup", // internal — called by facilitator with shared secret
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public auth paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(png|ico|svg|jpg|jpeg|gif|webp|css|js|map|woff2?)$/)
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const session = await verifySession(token);
  if (!session) {
    // Clear the stale cookie and redirect
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.set(COOKIE_NAME, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
    });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
