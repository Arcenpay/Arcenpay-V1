import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";

const FACILITATOR_URL =
  process.env.FACILITATOR_BASE_URL ||
  process.env.FACILITATOR_URL ||
  process.env.NEXT_PUBLIC_FACILITATOR_BASE_URL ||
  process.env.NEXT_PUBLIC_FACILITATOR_URL ||
  "http://localhost:3402";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.text();
    const upstream = await fetch(`${FACILITATOR_URL}/api/webhooks/test`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        ...(body
          ? {
              "Content-Type":
                request.headers.get("content-type") || "application/json",
            }
          : {}),
        ...(process.env.FACILITATOR_SECRET
          ? { Authorization: `Bearer ${process.env.FACILITATOR_SECRET}` }
          : {}),
      },
      ...(body ? { body } : {}),
      cache: "no-store",
    });

    const text = await upstream.text();
    const response = new NextResponse(text, { status: upstream.status });
    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      response.headers.set("content-type", contentType);
    }
    return response;
  } catch (err) {
    console.error("[api/webhooks/test]", err);
    return NextResponse.json(
      { error: "Facilitator unavailable" },
      { status: 503 },
    );
  }
}
