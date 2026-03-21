/**
 * GET /api/company — Fetch or upsert the demo company
 * POST /api/company — Identify (upsert) company with traits
 */
import { NextRequest, NextResponse } from "next/server";
import { getArcenClient } from "@/lib/arcen-client";

export async function GET() {
  try {
    const arcen = getArcenClient();
    const email = process.env.DEMO_COMPANY_EMAIL || "demo@acmescan.xyz";
    const res = await arcen.listCompanies({ search: email, limit: 1 });
    const company = res.data[0] ?? null;
    return NextResponse.json({ data: company });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const arcen = getArcenClient();
    const body = await req.json() as {
      name?: string;
      email?: string;
      wallet?: string;
      traits?: Record<string, unknown>;
    };

    // Try to identify via event first (upsert semantics)
    await fetch(`${process.env.ARCEN_BASE_URL || "http://localhost:3000"}/api/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ARCEN_API_KEY}`,
      },
      body: JSON.stringify({
        event_type: "identify",
        company: {
          email: body.email || process.env.DEMO_COMPANY_EMAIL || "demo@acmescan.xyz",
          wallet: body.wallet,
          name: body.name || "AcmeScan Demo Co",
        },
        traits: body.traits,
      }),
    });

    // Return fresh company data
    const email = body.email || process.env.DEMO_COMPANY_EMAIL || "demo@acmescan.xyz";
    const res = await arcen.listCompanies({ search: email, limit: 1 });
    return NextResponse.json({ data: res.data[0] ?? null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
