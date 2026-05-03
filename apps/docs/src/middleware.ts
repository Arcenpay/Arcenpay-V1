import { NextRequest, NextResponse } from "next/server";

const MARKDOWN_BYPASS_PARAM = "__markdown_bypass";

function shouldServeMarkdown(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (request.nextUrl.searchParams.has(MARKDOWN_BYPASS_PARAM)) return false;

  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  if (!accept.includes("text/markdown")) return false;

  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname.endsWith(".xml") ||
    pathname.endsWith(".txt") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".ico")
  ) {
    return false;
  }

  return true;
}

export function middleware(request: NextRequest) {
  if (!shouldServeMarkdown(request)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  const pathname =
    request.nextUrl.pathname === "/"
      ? "/api/markdown-agent/__index"
      : `/api/markdown-agent${request.nextUrl.pathname}`;
  url.pathname = pathname;
  url.searchParams.delete("path");
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/:path*",
};
