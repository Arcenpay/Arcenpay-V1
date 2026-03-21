/**
 * GET /api/flags?keys=flag1,flag2&companyId=xxx
 * Server-side flag evaluation proxy — keeps API key off the client.
 */
import { NextRequest, NextResponse } from "next/server";
import { getArcenClient } from "@/lib/arcen-client";

export async function GET(req: NextRequest) {
  try {
    const arcen = getArcenClient();
    const { searchParams } = req.nextUrl;
    const keys = searchParams.get("keys")?.split(",").filter(Boolean) ?? [];
    const companyId = searchParams.get("companyId");
    const wallet = searchParams.get("wallet");
    const email = searchParams.get("email");

    if (keys.length === 0) {
      return NextResponse.json({ error: "keys parameter required" }, { status: 400 });
    }

    const companyKeys = { id: companyId ?? undefined, wallet: wallet ?? undefined, email: email ?? undefined };
    if (!companyId && !wallet && !email) {
      return NextResponse.json({ error: "At least one company key required" }, { status: 400 });
    }

    const results = await arcen.checkFlags(keys, companyKeys);
    return NextResponse.json({ data: results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
