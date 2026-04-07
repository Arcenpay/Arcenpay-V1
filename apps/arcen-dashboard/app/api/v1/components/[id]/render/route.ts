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
import { createPublicClient, http } from "viem";
import {
  getContractAddresses,
  SubscriptionRegistryABI,
} from "@arcenpay/sdk";
import { db } from "@/lib/db";
import { resolveEntitlementResults } from "@/lib/entitlements";
import { getRpcUrl } from "@/lib/config";

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

// ─── Normalization helpers ────────────────────────────────────────────────────

/** Map editor kebab-case element types → camelCase SDK types */
function normalizeElementType(type: string): string {
  const map: Record<string, string> = {
    "plan-manager":       "planManager",
    "included-features":  "includedFeatures",
    "metered-features":   "meteredFeatures",
    "next-bill-due":      "nextBillDue",
    "payment-method":     "paymentMethod",
    "pricing-table":      "plansTable",
    // kebab self-maps (already correct but include for safety)
    "invoices":        "invoices",
    "unsubscribe":     "unsubscribe",
    "text":            "text",
    "button":          "button",
    "billing-history": "billingHistory",
  };
  return map[type] ?? type;
}

/**
 * Normalize the design/styling object saved by the dashboard editor.
 * Editor saves: { primaryColor, secondaryColor, fontFamily, fontSize, cardStyle, columns }
 * SDK reads:    { primaryColor, fontFamily, fontSize, fontColor, backgroundColor, borderRadius }
 */
function normalizeDesign(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    primaryColor:    raw.primaryColor    ?? "#000000",
    secondaryColor:  raw.secondaryColor  ?? "#f3f4f6",
    fontFamily:      raw.fontFamily      ?? "system-ui, sans-serif",
    fontSize:        raw.fontSize        ?? "14",
    cardStyle:       raw.cardStyle       ?? "minimal",
    fontColor:       raw.fontColor       ?? "#111827",
    backgroundColor: raw.backgroundColor ?? "#ffffff",
    borderRadius:    raw.borderRadius    ?? "8",
  };
}

// Handle CORS preflight requests from embedded apps
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
  if (!teamId) {
    return NextResponse.json({ error: "Invalid access token context" }, { status: 401 });
  }

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
  let nextBillingAt: string | null = null;
  let paymentMethod: Record<string, unknown> | null = null;
  let recentInvoices: Record<string, unknown>[] = [];

  if (companyId) {
    const [company, user] = await Promise.all([
      db.arcenCompany.findFirst({
        where: { id: companyId, teamId },
        select: {
          id: true,
          name: true,
          walletAddress: true,
          email: true,
          activePlanId: true,
        },
      }),
      userId
        ? db.arcenUser.findFirst({
            where: { id: userId, teamId },
            select: {
              id: true,
              name: true,
              email: true,
              walletAddress: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (company) {
      companyData = {
        id: company.id,
        name: company.name,
        walletAddress: company.walletAddress,
        email: company.email,
      };

      if (company.activePlanId) {
        activePlan = (await db.catalogPlan.findUnique({
          where: { id: company.activePlanId },
          select: {
            id: true,
            name: true,
            tier: true,
            price: true,
            annualPrice: true,
            billingInterval: true,
            description: true,
            acceptedToken: true,
          },
        })) as Record<string, unknown> | null;
      }

      const companyKeys = {
        internalId: company.id,
        wallet: company.walletAddress ?? undefined,
        email: company.email ?? undefined,
      };
      const userKeys = user
        ? { internalId: user.id }
        : undefined;

      const [flags, entitlementResults] = await Promise.all([
        db.catalogFeatureFlag.findMany({
          where: { teamId },
          select: {
            featureKey: true,
            name: true,
            featureType: true,
            unitSingular: true,
            unitPlural: true,
          },
        }),
        resolveEntitlementResults({
          teamId,
          companyKeys,
          userKeys,
        }),
      ]);

      const flagMap = new Map(flags.map((flag) => [flag.featureKey, flag]));

      entitlements = entitlementResults.entitlements.map((entitlement) => {
        const flag = flagMap.get(entitlement.key);
        const featureType =
          flag?.featureType ??
          (entitlement.allocation !== null ? "event_based" : "boolean");

        return {
          featureKey: entitlement.key,
          name: flag?.name ?? entitlement.key,
          value:
            featureType === "event_based"
              ? entitlement.allocation ?? entitlement.usage
              : entitlement.enabled,
          featureType,
          limit: entitlement.allocation ?? undefined,
          usage: entitlement.usage,
          exceeded: entitlement.exceeded,
          unitSingular: flag?.unitSingular ?? null,
          unitPlural: flag?.unitPlural ?? flag?.unitSingular ?? null,
        };
      });

      usageData = entitlements
        .filter((entitlement) => entitlement.featureType === "event_based")
        .map((entitlement) => ({
          featureKey: entitlement.featureKey,
          name: entitlement.name,
          used: entitlement.usage ?? 0,
          limit: entitlement.limit ?? undefined,
          unitSingular: entitlement.unitSingular ?? null,
          unitPlural: entitlement.unitPlural ?? null,
        }));

      const invoiceFilters = [
        company.walletAddress
          ? { customerWallet: company.walletAddress.toLowerCase() }
          : null,
        company.email ? { customerEmail: company.email } : null,
        user?.email ? { customerEmail: user.email } : null,
      ].filter(Boolean);

      if (invoiceFilters.length > 0) {
        const invoices = await db.invoice.findMany({
          where: {
            teamId,
            OR: invoiceFilters as never,
          },
          orderBy: { issuedAt: "desc" },
          take: 10,
          select: {
            id: true,
            number: true,
            total: true,
            currency: true,
            status: true,
            issuedAt: true,
            dueAt: true,
            paidAt: true,
            customerEmail: true,
            customerWallet: true,
          },
        });

        recentInvoices = invoices.map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          total: String(invoice.total),
          currency: invoice.currency,
          status: invoice.status,
          issuedAt: invoice.issuedAt?.toISOString() ?? null,
          dueAt: invoice.dueAt?.toISOString() ?? null,
          paidAt: invoice.paidAt?.toISOString() ?? null,
          customerEmail: invoice.customerEmail,
          customerWallet: invoice.customerWallet,
        }));
      }

      const configuredChainId = Number(
        process.env.MEAP_DEFAULT_CHAIN_ID ||
          process.env.CHAIN_ID ||
          process.env.NEXT_PUBLIC_CHAIN_ID ||
          "11155111",
      );

      paymentMethod = {
        walletAddress: company.walletAddress ?? user?.walletAddress ?? null,
        token:
          typeof activePlan?.acceptedToken === "string"
            ? activePlan.acceptedToken
            : "USDC",
        chainId: configuredChainId,
      };

      if (company.walletAddress) {
        try {
          const client = createPublicClient({
            transport: http(getRpcUrl(configuredChainId)),
          });
          const contracts = getContractAddresses(configuredChainId);
          const tokenId = (await client.readContract({
            address: contracts.subscriptionRegistry as `0x${string}`,
            abi: SubscriptionRegistryABI,
            functionName: "getWalletSubscription",
            args: [company.walletAddress.toLowerCase() as `0x${string}`],
          })) as bigint;

          if (tokenId > 0n) {
            const expiration = (await client.readContract({
              address: contracts.subscriptionRegistry as `0x${string}`,
              abi: SubscriptionRegistryABI,
              functionName: "expiresAt",
              args: [tokenId],
            })) as bigint;
            if (expiration > 0n) {
              nextBillingAt = new Date(Number(expiration) * 1000).toISOString();
            }
          }
        } catch {
          nextBillingAt = null;
        }
      }
    }
  }

  // Load all published plans for the plans table element
  const allPlans = await db.catalogPlan.findMany({
    where: { teamId, status: "PUBLISHED", active: true },
    orderBy: { price: "asc" },
    select: { id: true, name: true, tier: true, price: true, annualPrice: true, billingInterval: true, description: true, metadata: true, acceptedToken: true },
  });

  // Get provider's wallet (team owner) for payment routing
  const teamOwnerMember = await db.teamMember.findFirst({
    where: { teamId: teamId ?? "", role: "OWNER" },
    select: { user: { select: { walletAddress: true } } },
  });
  const providerWallet = teamOwnerMember?.user?.walletAddress ?? null;

  const rawElements = Array.isArray(component.elements) ? component.elements as Array<Record<string, unknown>> : [];
  const rawDesign = (component.design ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    data: {
      component: {
        id: component.id,
        name: component.name,
        elements: rawElements.map((el) => ({
          ...el,
          type: normalizeElementType(String(el.type ?? "")),
        })),
        design: normalizeDesign(rawDesign),
      },
      company: companyData,
      activePlan,
      plans: allPlans,
      entitlements,
      usage: usageData,
      userId,
      providerWallet,
      nextBillingAt,
      paymentMethod,
      recentInvoices,
    },
  });
}
