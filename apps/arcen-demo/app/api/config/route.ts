import { NextResponse } from "next/server";
import { ARCENPAY_APP_URL } from "@arcenpay/node/core";

/**
 * GET /api/config
 *
 * Returns safe public configuration values for the frontend.
 */
export async function GET() {
  return NextResponse.json({
    componentId: process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID ?? "",
    baseUrl: ARCENPAY_APP_URL,
    demoCompanyWallet:
      process.env.DEMO_COMPANY_WALLET ??
      "0x0000000000000000000000000000000000000001",
    hasApiKey: !!process.env.ARCENPAY_API_KEY,
    hasPublishableKey: !!process.env.NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY,
  });
}
