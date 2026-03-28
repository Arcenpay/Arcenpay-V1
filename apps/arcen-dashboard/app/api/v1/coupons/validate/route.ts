/**
 * GET /api/v1/coupons/validate?code=XXX
 *
 * Validates a coupon/promo code and returns the discount percentage.
 * Called by the ArcenEmbed checkout widget.
 */

import { NextRequest, NextResponse } from "next/server";

// CORS for embed
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
  });
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase();

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  // TODO: Replace with DB lookup against a CatalogCoupon table when ready.
  // For now, a small set of well-known codes for demo/testing.
  const KNOWN: Record<string, { discount: number; description: string }> = {
    LAUNCH20:  { discount: 20, description: "20% off launch promo" },
    EARLY10:   { discount: 10, description: "10% early adopter discount" },
    SAVE15:    { discount: 15, description: "15% off" },
    ARCENPAY:  { discount: 25, description: "25% ArcenPay partner discount" },
  };

  const coupon = KNOWN[code];
  if (!coupon) {
    return NextResponse.json({ error: "Invalid or expired coupon" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  return NextResponse.json(
    { code, discount: coupon.discount, description: coupon.description },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
