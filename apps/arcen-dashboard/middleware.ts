// ============================================================
//  ArcenPay Dashboard — Route Guard Middleware
//  Runs on the Edge runtime. Reads the SIWE JWT session cookie
//  and redirects unauthenticated requests to /login.
//  PRD §2.1 — Dashboard Auth Flow
// ============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "meap-session";

/**
 * Paths that do NOT require authentication.
 * Everything else is gated behind the JWT session cookie.
 */
const PUBLIC_PATHS = [
    "/login",
    "/api/auth/nonce",
    "/api/auth/verify",
    "/api/auth/logout",
];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Allow public paths through without auth check
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
        return NextResponse.next();
    }

    // Skip Next.js internals and static assets
    if (
        pathname.startsWith("/_next/") ||
        pathname.startsWith("/favicon") ||
        pathname.startsWith("/icon") ||
        pathname.startsWith("/apple-icon") ||
        pathname.endsWith(".png") ||
        pathname.endsWith(".svg") ||
        pathname.endsWith(".ico")
    ) {
        return NextResponse.next();
    }

    const token = request.cookies.get(COOKIE_NAME)?.value;

    // No session cookie → redirect to login
    if (!token) {
        const loginUrl = new URL("/login", request.url);
        if (pathname !== "/") {
            loginUrl.searchParams.set("callbackUrl", pathname);
        }
        return NextResponse.redirect(loginUrl);
    }

    // Verify the JWT — Edge-compatible via jose
    try {
        const jwtSecret =
            process.env.SIWE_JWT_SECRET || "dev_secret_change_in_production";
        const secret = new TextEncoder().encode(jwtSecret);
        await jwtVerify(token, secret);
        return NextResponse.next();
    } catch {
        // Token is invalid or expired — clear cookie and redirect
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        const response = NextResponse.redirect(loginUrl);
        response.cookies.delete(COOKIE_NAME);
        return response;
    }
}

export const config = {
    // Match all routes except Next.js internals and static files
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|icon-|apple-icon|public/).*)",
    ],
};
