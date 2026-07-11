import { NextRequest } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || "http://localhost:3300";

async function handler(request: NextRequest) {
  const url = new URL(request.url);
  let path = url.pathname;

  if (path === "/api/health") {
    return Response.json({
      status: "ok",
      service: "arcen-dashboard",
      timestamp: new Date().toISOString(),
    });
  }

  // Rewrite /api/xxx → /api/v1/xxx, but /api/v1/xxx stays as-is
  if (path.startsWith("/api/") && !path.startsWith("/api/v1/")) {
    path = path.replace("/api/", "/api/v1/");
  }

  const backendUrl = `${BACKEND}${path}${url.search}`;

  // Forward headers (strip host, add forwarded)
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key === "host" || key === "content-length") return;
    headers[key] = value;
  });
  headers["x-forwarded-host"] = url.host;
  headers["x-forwarded-proto"] = url.protocol.replace(":", "");
  headers["x-forwarded-port"] =
    url.port || (url.protocol === "https:" ? "443" : "80");

  let res: Response;
  try {
    res = await fetch(backendUrl, {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD"
        ? await request.text()
        : undefined,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Backend unreachable", details: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  // Forward response
  const responseHeaders = new Headers();
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];

  res.headers.forEach((value, key) => {
    if (key === "content-encoding" || key === "set-cookie") return; // Let Next.js handle encoding
    responseHeaders.set(key, value);
  });
  for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(res.body, {
    status: res.status,
    headers: responseHeaders,
  });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };
