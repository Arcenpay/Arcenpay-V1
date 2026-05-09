import { NextRequest } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || "http://localhost:3300";

async function handler(request: NextRequest) {
  const url = new URL(request.url);
  let path = url.pathname;

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

  const res = await fetch(backendUrl, {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD"
      ? await request.text()
      : undefined,
  });

  // Forward response
  const responseHeaders = new Headers();
  res.headers.forEach((value, key) => {
    if (key === "content-encoding") return; // Let Next.js handle encoding
    responseHeaders.set(key, value);
  });

  return new Response(res.body, {
    status: res.status,
    headers: responseHeaders,
  });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };
