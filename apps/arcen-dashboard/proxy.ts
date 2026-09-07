import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth-constants";

const PUBLIC_PATHS = [
  /^\/login(?:\/.*)?$/,
  /^\/sign-in(?:\/.*)?$/,
  /^\/sign-up(?:\/.*)?$/,
  /^\/invite(?:\/.*)?$/,
  /^\/api\/.*/,
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PATHS.some((pattern) => pattern.test(pathname));
}

function clearLegacyHostOnlySessionCookie(response: NextResponse): NextResponse {
  if (process.env.NODE_ENV === "production") {
    // Older dashboard releases wrote arcen_session without a Domain attribute.
    // That app.arcenpay.com-only cookie can shadow the valid .arcenpay.com
    // session on server requests. Omitting Domain here deletes only that legacy
    // host-only cookie; the shared API/dashboard cookie remains intact.
    response.cookies.delete(AUTH_COOKIE_NAME);
  }
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(
    request.cookies.get(AUTH_COOKIE_NAME)?.value,
  );

  if (isPublicRoute(pathname)) {
    return clearLegacyHostOnlySessionCookie(NextResponse.next());
  }

  if (!hasSessionCookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    const next = `${pathname}${request.nextUrl.search}`;
    if (next && next !== "/") {
      loginUrl.searchParams.set("next", next);
    }
    console.warn("[DEBUG-auth-20260907] dashboard redirect", {
      pathname,
      hasSessionCookie: false,
      redirectTo: loginUrl.pathname,
    });
    return clearLegacyHostOnlySessionCookie(NextResponse.redirect(loginUrl));
  }

  return clearLegacyHostOnlySessionCookie(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
