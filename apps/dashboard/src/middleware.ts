import { NextRequest, NextResponse } from "next/server";
import { unsealData } from "iron-session";
import {
  sessionOptions,
  type SessionData,
  defaultSession,
} from "@/lib/session";

function unauthorized(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  return NextResponse.redirect(new URL("/login", req.url));
}

export async function middleware(req: NextRequest) {
  const sessionCookie = req.cookies.get(sessionOptions.cookieName)?.value;
  if (!sessionCookie) {
    return unauthorized(req);
  }

  const ttl =
    sessionOptions.ttl ??
    (typeof sessionOptions.cookieOptions?.maxAge === "number"
      ? sessionOptions.cookieOptions.maxAge
      : undefined);

  try {
    const session = await unsealData<SessionData>(sessionCookie, {
      password: sessionOptions.password,
      ttl,
    });

    if (
      !session?.isLoggedIn ||
      !session?.address ||
      session.chainId === defaultSession.chainId
    ) {
      return unauthorized(req);
    }
  } catch {
    return unauthorized(req);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
