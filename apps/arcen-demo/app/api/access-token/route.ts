/**
 * POST /api/access-token — Generate a short-lived access token for ArcenEmbed
 * Calls ArcenClient.createAccessToken() server-side to keep the API key secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { getArcenClient } from "@/lib/arcen-client";

export async function POST(req: NextRequest) {
  try {
    const arcen = getArcenClient();
    const body = (await req.json()) as {
      company?: { wallet?: string; email?: string; id?: string };
      user?: { wallet?: string; clerkUserId?: string; id?: string };
      expiresIn?: number;
    };

    const companyKeys = body.company ?? {};
    const userKeys = body.user;
    const expiresIn = body.expiresIn ?? 3600;

    const result = await arcen.createAccessToken(
      companyKeys,
      userKeys,
      expiresIn,
    );

    return NextResponse.json({ token: result.token, expiresAt: result.expiresAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
