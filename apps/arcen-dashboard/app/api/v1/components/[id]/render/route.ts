/**
 * GET /api/v1/components/:id/render
 *
 * Returns component config + company-specific data (plan, usage, entitlements)
 * for rendering an embeddable ArcenEmbed component.
 *
 * Requires: Authorization: Bearer <access_token> (short-lived embed token)
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { evaluateFlags } from "@/lib/flag-engine";
import { aggregateUsage } from "@/lib/event-aggregator";

// Verify and decode an embed access token
function verifyAccessToken(token: string, secret: string): {
  valid: boolean;
  teamId?: string;
  companyId?: string;
  userId?: string;
} {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { valid: false };

    const [header, body, sig] = parts;
    const unsigned = `${header}.${body}`;
    const { createHmac } = require("crypto") as typeof import("crypto");
    const expectedSig = createHmac("sha256", secret).update(unsigned).digest("base64url");

    if (sig !== expectedSig) return { valid: false };

    const payload = JSON.parse(Buffer.from(body, "base64url").toString());

    if (payload.exp < Math.floor(Date.now() / 1000)) return { valid: false };

    return {
      valid: true,
      teamId: payload.teamId,
      companyId: payload.companyId ?? undefined,
      userId: payload.userId ?? undefined,
    };
  } catch {
    return { valid: false };
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Extract token from Authorization header or query param
  const authHeader = req.headers.get("authorization");
  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Access token required" }, { status: 401 });
  }

  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const decoded = verifyAccessToken(token, secret);
  if (!decoded.valid) {
    return NextResponse.json({ error: "Invalid or expired access token" }, { status: 401 });
  }

  // Check for revocation
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const storedToken = await db.embedAccessToken.findUnique({
    where: { tokenHash },
    select: { id: true, expiresAt: true },
  });
  if (!storedToken || storedToken.expiresAt < new Date()) {
    return NextResponse.json({ error: "Token revoked or expired" }, { status: 401 });
  }

  const { teamId, companyId, userId } = decoded;

  // Load the component
  const component = await db.embedComponent.findFirst({
    where: { id, teamId },
  });

  if (!component) {
    return NextResponse.json({ error: "Component not found" }, { status: 404 });
  }

  // Load company data
  let companyData: Record<string, unknown> | null = null;
  let activePlan: Record<string, unknown> | null = null;
  let usageData: Record<string, unknown>[] = [];
  let entitlements: Record<string, unknown>[] = [];

  if (companyId) {
    const company = await db.schematicCompany.findFirst({
      where: { id: companyId, teamId },
      select: {
        id: true,
        name: true,
        walletAddress: true,
        email: true,
        activePlanId: true,
        activeAddOnIds: true,
        traits: true,
      },
    });

    if (company) {
      companyData = {
        id: company.id,
        name: company.name,
        walletAddress: company.walletAddress,
      };

      if (company.activePlanId) {
        activePlan = (await db.catalogPlan.findUnique({
          where: { id: company.activePlanId },
          select: { id: true, name: true, tier: true, price: true, billingInterval: true, description: true },
        })) as Record<string, unknown> | null;
      }

      // Load all feature flags and evaluate them for this company
      const flags = await db.catalogFeatureFlag.findMany({
        where: { teamId },
        select: { featureKey: true, name: true, featureType: true, unitSingular: true, unitPlural: true, eventKey: true },
      });

      const companyKeys = {
        id: undefined,
        wallet: company.walletAddress ?? undefined,
        email: company.email ?? undefined,
      };

      if (flags.length > 0) {
        const flagResults = await evaluateFlags(
          teamId ?? "",
          flags.map((f) => f.featureKey),
          companyKeys,
        );

        entitlements = flagResults.map((r, i) => ({
          featureKey: r.flag,
          name: flags[i]?.name,
          value: r.value,
          featureType: flags[i]?.featureType ?? "boolean",
        }));

        // For event-based features, add usage data
        for (const flag of flags) {
          if (flag.featureType === "event_based" && flag.eventKey) {
            const count = await aggregateUsage(teamId ?? "", companyId ?? "", flag.eventKey, "monthly");
            usageData.push({
              featureKey: flag.featureKey,
              name: flag.name,
              unitSingular: flag.unitSingular,
              unitPlural: flag.unitPlural,
              used: count,
            });
          }
        }
      }
    }
  }

  // Load all published plans for the plans table element
  const allPlans = await db.catalogPlan.findMany({
    where: { teamId, status: "PUBLISHED", active: true },
    orderBy: { price: "asc" },
    select: { id: true, name: true, tier: true, price: true, billingInterval: true, description: true, metadata: true },
  });

  return NextResponse.json({
    data: {
      component: {
        id: component.id,
        name: component.name,
        elements: component.elements,
        design: component.design,
      },
      company: companyData,
      activePlan,
      plans: allPlans,
      entitlements,
      usage: usageData,
      userId,
    },
  });
}
