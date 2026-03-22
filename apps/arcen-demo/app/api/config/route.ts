/**
 * POST /api/config — Store demo config in memory for server-side routes.
 * In production you'd use a session/cookie instead.
 */
import { NextRequest, NextResponse } from "next/server";

// Module-level store (fine for single-user demo)
export let demoConfig: { apiKey: string; baseUrl: string; companyEmail: string } | null = null;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { apiKey: string; baseUrl?: string };
  demoConfig = {
    apiKey: body.apiKey,
    baseUrl: body.baseUrl || "http://localhost:3000",
    companyEmail: process.env.DEMO_COMPANY_EMAIL || "demo@acmescan.xyz",
  };
  return NextResponse.json({ ok: true, configured: true });
}

export async function GET() {
  // Check env-var config first (skips setup screen)
  const envApiKey = process.env.ARCEN_API_KEY;
  if (envApiKey && !demoConfig) {
    demoConfig = {
      apiKey: envApiKey,
      baseUrl: process.env.ARCEN_BASE_URL || "http://localhost:3000",
      companyEmail: process.env.DEMO_COMPANY_EMAIL || "demo@acmescan.xyz",
    };
  }
  return NextResponse.json({ data: demoConfig, configured: demoConfig !== null });
}
