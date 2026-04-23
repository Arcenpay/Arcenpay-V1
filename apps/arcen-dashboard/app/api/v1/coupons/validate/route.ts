/**
 * GET /api/v1/coupons/validate?code=XXX&planId=YYY&billingPeriod=monthly|annual
 *
 * Validates a coupon for a specific published plan and returns the canonical
 * quote that the embed should display and charge.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import { resolveEmbedAccessToken } from "@/lib/embed-access-token";
import {
  normalizeBillingPeriod,
  resolveCouponQuote,
} from "@/lib/catalog-billing";

const querySchema = z.object({
  code: z.string().trim().min(1),
  planId: z.string().trim().min(1),
  billingPeriod: z
    .enum(["monthly", "annual", "yearly"])
    .transform((value) => normalizeBillingPeriod(value))
    .optional(),
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

async function resolveRequestTeamId(
  req: NextRequest,
): Promise<string | null | NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (bearerToken && !bearerToken.startsWith("api_")) {
    const embedToken = await resolveEmbedAccessToken(bearerToken);
    if (!embedToken?.teamId) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401, headers: corsHeaders() },
      );
    }
    return embedToken.teamId;
  }

  const auth = await requireAnyAuth(req);
  if (isAnyAuthError(auth)) return auth;
  return auth.teamId;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse({
    code: req.nextUrl.searchParams.get("code"),
    planId: req.nextUrl.searchParams.get("planId"),
    billingPeriod: req.nextUrl.searchParams.get("billingPeriod") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400, headers: corsHeaders() },
    );
  }

  const teamIdOrError = await resolveRequestTeamId(req);
  if (teamIdOrError instanceof NextResponse) {
    return teamIdOrError;
  }
  if (!teamIdOrError) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders() },
    );
  }

  const quoteResult = await resolveCouponQuote({
    teamId: teamIdOrError,
    planId: parsed.data.planId,
    billingPeriod: parsed.data.billingPeriod,
    couponCode: parsed.data.code,
  });

  if (!quoteResult.ok) {
    return NextResponse.json(
      { error: quoteResult.error },
      { status: quoteResult.status, headers: corsHeaders() },
    );
  }

  return NextResponse.json(
    {
      code: quoteResult.quote.coupon?.code ?? parsed.data.code.trim().toUpperCase(),
      discount: quoteResult.quote.coupon?.discountPercent ?? 0,
      description: quoteResult.quote.coupon?.description ?? null,
      planId: quoteResult.quote.planId,
      billingPeriod: quoteResult.quote.billingPeriod,
      baseAmount: quoteResult.quote.baseAmount,
      discountedAmount: quoteResult.quote.finalAmount,
      baseAmountMicros: quoteResult.quote.baseAmountMicros,
      discountedAmountMicros: quoteResult.quote.finalAmountMicros,
      currency: quoteResult.quote.currency,
    },
    { headers: corsHeaders() },
  );
}
