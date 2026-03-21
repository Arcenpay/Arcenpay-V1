/**
 * POST /api/config — Store demo config in memory for server-side routes.
 * In production you'd use a session/cookie instead.
 */
import { NextRequest, NextResponse } from "next/server";

// Module-level store (fine for single-user demo)
export let demoConfig: { apiKey: string; baseUrl: string; companyEmail: string } | null = null;

export async function POST(req: NextRequest) {
  const body = await req.json() as typeof demoConfig;
  demoConfig = body;
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ data: demoConfig });
}
