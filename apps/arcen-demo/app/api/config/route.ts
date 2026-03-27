import { NextResponse } from "next/server";

/**
 * GET /api/config
 *
 * Returns safe public configuration values for the frontend.
 */
export async function GET() {
  return NextResponse.json({
    componentId: process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID ?? "",
    baseUrl: process.env.ARCENPAY_BASE_URL ?? "https://dashboard.arcenpay.xyz",
    demoCompanyWallet:
      process.env.DEMO_COMPANY_WALLET ??
      "0x0000000000000000000000000000000000000001",
    hasApiKey: !!process.env.ARCENPAY_API_KEY,
  });
}
