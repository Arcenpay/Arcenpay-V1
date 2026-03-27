import { NextRequest, NextResponse } from "next/server";
import { getArcenClient, getDemoCompanyKeys } from "@/lib/arcen-client";

/**
 * POST /api/track
 * Body: { name: string, traits?: Record<string, unknown> }
 *
 * Tracks a usage event for the current company via ArcenClient.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; traits?: Record<string, unknown> };
    if (!body.name) {
      return NextResponse.json({ error: "Missing event name" }, { status: 400 });
    }

    const client = getArcenClient();
    const companyKeys = getDemoCompanyKeys();

    await client.track({
      name: body.name,
      company: companyKeys,
      traits: body.traits,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to track event";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
