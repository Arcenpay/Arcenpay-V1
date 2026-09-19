/**
 * GET /api/v1/coupons/validate?code=XXX&planId=YYY&billingPeriod=monthly|annual
 *
 * Validates a coupon for a specific published plan and returns the canonical
 * quote that the embed should display and charge.
 */

import type { Context } from "hono";
import { z } from "zod";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import { isApiKeyToken } from "../../lib/auth/api-key-auth.js";
import { resolveEmbedAccessToken } from "../../lib/entitlements/embed-access-token.js";
import {
  normalizeBillingPeriod,
  resolveCouponQuote,
} from "../../lib/catalog/catalog-billing.js";
import { corsHeaders } from "../../middleware/cors.js";

const querySchema = z.object({
  code: z.string().trim().min(1),
  planId: z.string().trim().min(1),
  billingPeriod: z
    .enum(["monthly", "annual", "yearly"])
    .transform((value) => normalizeBillingPeriod(value))
    .optional(),
});

async function resolveRequestTeamId(
  c: Context,
): Promise<string | null | Response> {
  const authHeader = c.req.header("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (bearerToken && !isApiKeyToken(bearerToken)) {
    const embedToken = await resolveEmbedAccessToken(bearerToken);
    if (!embedToken?.teamId) {
      return c.json(
        { error: "Invalid or expired token" },
        401,
        corsHeaders(c.req.header("origin")),
      );
    }
    return embedToken.teamId;
  }

  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);
  return auth.teamId;
}

export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

export async function GET(c: Context) {
  const parsed = querySchema.safeParse({
    code: c.req.query("code"),
    planId: c.req.query("planId"),
    billingPeriod: c.req.query("billingPeriod") ?? undefined,
  });

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400,
      corsHeaders(c.req.header("origin")),
    );
  }

  const teamIdOrError = await resolveRequestTeamId(c);
  if (teamIdOrError instanceof Response) {
    return teamIdOrError;
  }
  if (!teamIdOrError) {
    return c.json(
      { error: "Unauthorized" },
      401,
      corsHeaders(c.req.header("origin")),
    );
  }

  const quoteResult = await resolveCouponQuote({
    teamId: teamIdOrError,
    planId: parsed.data.planId,
    billingPeriod: parsed.data.billingPeriod,
    couponCode: parsed.data.code,
  });

  if (!quoteResult.ok) {
    return c.json(
      { error: quoteResult.error },
      quoteResult.status,
      corsHeaders(c.req.header("origin")),
    );
  }

  return c.json(
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
    200,
    corsHeaders(c.req.header("origin")),
  );
}
