import { NextRequest, NextResponse } from "next/server";
import { getArcenClient, getDemoCompanyKeys } from "@/lib/arcen-client";

/**
 * GET /api/flags?key=<featureKey>
 *
 * Server-side flag check for the current company.
 * Returns { value: boolean, reason: string }
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key param" }, { status: 400 });
  }

  try {
    const client = getArcenClient();
    const companyKeys = getDemoCompanyKeys();
    const result = await client.checkFlag(key, companyKeys);
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check flag";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
