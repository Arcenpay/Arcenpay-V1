import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth-constants";

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
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // Browser sessions are authenticated directly by api.arcenpay.com. Do not
  // redirect here based on a dashboard-origin cookie: the backend API is the
  // authorization boundary and the client-side guard verifies it directly.
  return clearLegacyHostOnlySessionCookie(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
