import { NextResponse } from "next/server";
import { getArcenClient, getDemoCompanyKeys } from "@/lib/arcen-client";

/**
 * POST /api/access-token
 *
 * Generates a short-lived ArcenPay access token for the current "logged-in"
 * company. Used by <ArcenEmbed> on the billing page.
 */
export async function POST() {
  try {
    const client = getArcenClient();
    const companyKeys = getDemoCompanyKeys();
    const token = await client.createAccessToken(companyKeys, undefined, 3600);
    return NextResponse.json({ token });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create access token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
