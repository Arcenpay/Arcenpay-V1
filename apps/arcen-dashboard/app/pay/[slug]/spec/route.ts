import { NextRequest } from "next/server";

const BACKEND =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:3300";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const params = await context.params;
  const slug = params.slug;
  const backendUrl = `${BACKEND}/api/v1/public/payment-links/${slug}/spec`;

  try {
    const res = await fetch(backendUrl, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const data = await res.json();
    return Response.json(data, {
      status: res.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to resolve payment link spec", details: String(err) },
      {
        status: 502,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
    },
  });
}
