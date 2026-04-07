/**
 * POST /api/v1/companies/unsubscribe
 *
 * Cancel the authenticated company's subscription (switches to free plan).
 * Auth: Bearer <embed_access_token>
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { deliverWebhook } from "@/lib/deliver-webhook";
import { toPrismaJson } from "@/lib/prisma-json";

type SubscriptionTransition = {
  mode: "period_end_downgrade" | "cancel_at_period_end";
  targetPlanId: string | null;
  targetPlanName: string | null;
  previousPlanId: string | null;
  requestedAt: string;
  effectiveAt: string | null;
  source: "self_service";
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function verifyAccessToken(token: string, secret: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { valid: false };
    const [header, body, sig] = parts;
    const unsigned = `${header}.${body}`;
    const { createHmac } = require("crypto") as typeof import("crypto");
    const expectedSig = createHmac("sha256", secret)
      .update(unsigned)
      .digest("base64url");
    if (sig !== expectedSig) return { valid: false };
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return { valid: false };
    return {
      valid: true,
      teamId: payload.teamId as string,
      companyId: payload.companyId as string | null,
    };
  } catch {
    return { valid: false };
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.slice(7);
  if (!token)
    return NextResponse.json(
      { error: "Access token required" },
      { status: 401, headers: corsHeaders() },
    );

  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500, headers: corsHeaders() },
    );

  const decoded = verifyAccessToken(token, secret);
  if (!decoded.valid || !decoded.teamId)
    return NextResponse.json(
      { error: "Invalid token" },
      { status: 401, headers: corsHeaders() },
    );

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const stored = await db.embedAccessToken.findUnique({
    where: { tokenHash },
    select: { expiresAt: true },
  });
  if (!stored || stored.expiresAt < new Date())
    return NextResponse.json(
      { error: "Token expired" },
      { status: 401, headers: corsHeaders() },
    );

  const { teamId, companyId } = decoded;
  if (!companyId)
    return NextResponse.json(
      { error: "No company" },
      { status: 400, headers: corsHeaders() },
    );

  const [company, freePlan] = await Promise.all([
    db.arcenCompany.findUnique({
      where: { id: companyId },
      select: { id: true, activePlanId: true, traits: true },
    }),
    db.catalogPlan.findFirst({
      where: { teamId, status: "PUBLISHED", active: true },
      orderBy: [{ price: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  if (!company) {
    return NextResponse.json(
      { error: "Company not found" },
      { status: 404, headers: corsHeaders() },
    );
  }

  if (!freePlan) {
    return NextResponse.json(
      {
        error:
          "No published fallback plan is available. Publish a free plan before allowing self-service cancellation.",
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const currentTraits = asRecord(company.traits);

  if (!company.activePlanId || company.activePlanId === freePlan.id) {
    const nextTraits = { ...currentTraits };
    delete nextTraits.subscriptionTransition;

    await db.arcenCompany.update({
      where: { id: companyId },
      data: {
        activePlanId: freePlan.id,
        traits: toPrismaJson(nextTraits),
      },
    });

    return NextResponse.json(
      {
        data: {
          success: true,
          scheduled: false,
          mode: "already_free",
          planId: freePlan.id,
        },
      },
      { headers: corsHeaders() },
    );
  }

  const transition: SubscriptionTransition = {
    mode: "cancel_at_period_end",
    targetPlanId: freePlan.id,
    targetPlanName: freePlan.name,
    previousPlanId: company.activePlanId,
    requestedAt: new Date().toISOString(),
    effectiveAt: null,
    source: "self_service",
  };

  await db.arcenCompany.update({
    where: { id: companyId },
    data: {
      traits: toPrismaJson({
        ...currentTraits,
        subscriptionTransition: transition,
      }),
    },
  });

  // Fire outbound webhook (non-blocking)
  deliverWebhook(teamId, "company.plan.cancelled", {
    companyId,
    freePlanId: freePlan.id,
    scheduled: true,
    mode: "period_end",
  }).catch(() => {});

  return NextResponse.json(
    {
      data: {
        success: true,
        scheduled: true,
        mode: "period_end",
        planId: freePlan.id,
        effectiveAt: null,
      },
    },
    { headers: corsHeaders() },
  );
}
