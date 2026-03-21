/**
 * POST /api/track — Track a usage event
 * Body: { name: string, companyId?: string, wallet?: string, traits?: Record<string,unknown> }
 */
import { NextRequest, NextResponse } from "next/server";
import { getArcenClient } from "@/lib/arcen-client";

export async function POST(req: NextRequest) {
  try {
    const arcen = getArcenClient();
    const body = await req.json() as {
      name: string;
      companyId?: string;
      wallet?: string;
      email?: string;
      traits?: Record<string, unknown>;
    };

    if (!body.name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    await arcen.track({
      name: body.name,
      company: {
        id: body.companyId,
        wallet: body.wallet,
        email: body.email || process.env.DEMO_COMPANY_EMAIL || "demo@acmescan.xyz",
      },
      traits: body.traits,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
