import { NextRequest, NextResponse } from "next/server";
import { getSession, getDbUser } from "@/lib/auth.server";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "@/lib/config";

type RouteParams = {
  provider: string;
  segments?: string[];
};

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

async function forwardRequest(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await getDbUser(session.clerkUserId);
  if (!dbUser?.walletAddress) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { provider, segments = [] } = await context.params;
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  if (!isAddress(normalizedProvider)) {
    return NextResponse.json(
      { error: "Invalid provider address" },
      { status: 400 },
    );
  }

  if (dbUser.walletAddress.toLowerCase() !== normalizedProvider) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const encodedSegments = segments.map((segment) =>
    encodeURIComponent(segment),
  );
  const pathSuffix =
    encodedSegments.length > 0 ? `/${encodedSegments.join("/")}` : "";
  const targetUrl = `${FACILITATOR_URL}/api/entitlements/provider/${normalizedProvider}/flags${pathSuffix}${request.nextUrl.search}`;

  if (method === "POST" && segments[0] !== "bootstrap") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const bodyText =
    method === "GET" || method === "DELETE" ? undefined : await request.text();

  const upstream = await fetch(targetUrl, {
    method,
    headers: {
      Accept: "application/json",
      ...(bodyText
        ? {
            "Content-Type":
              request.headers.get("content-type") || "application/json",
          }
        : {}),
      ...(FACILITATOR_SECRET
        ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
        : {}),
    },
    ...(bodyText ? { body: bodyText } : {}),
    cache: "no-store",
  });

  const text = await upstream.text();
  const response = new NextResponse(text, {
    status: upstream.status,
  });

  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    response.headers.set("content-type", contentType);
  }

  return response;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  return forwardRequest("GET", request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  return forwardRequest("POST", request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  return forwardRequest("PUT", request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  return forwardRequest("PATCH", request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  return forwardRequest("DELETE", request, context);
}
