import type { Context } from "hono";
import { db } from "../../../db.js";
import { apiError } from "../../../utils/api-response.js";
import { Prisma } from "../../../generated/client/client.js";
import { requireAnyAuth, isAnyAuthError } from "../../../lib/auth/require-any-auth.js";
import { YEARLY_INTERVAL } from "@arcenpay/internal-core";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeBillingPeriod(value: unknown): "monthly" | "annual" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "annual" || normalized === "yearly") return "annual";
  if (normalized === "monthly" || normalized === "month") return "monthly";
  return null;
}

export async function listCompanies(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  const { teamId } = auth;
  const environmentId = auth.activeEnvironmentId;
  if (!environmentId) {
    return apiError(c, "No workspace environment selected", {
      status: 409,
      code: "INVALID_INPUT",
    });
  }
  const url = new URL(c.req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const cursor = url.searchParams.get("cursor");
  const search = url.searchParams.get("search");

  const companies = await db.arcenCompany.findMany({
    where: {
      teamId,
      environmentId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { walletAddress: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { lastSeenAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      walletAddress: true,
      email: true,
      externalId: true,
      activePlanId: true,
      traits: true,
      logoUrl: true,
      createdAt: true,
      lastSeenAt: true,
    },
  });

  const hasMore = companies.length > limit;
  const items = hasMore ? companies.slice(0, limit) : companies;
  const activePlanIds = [
    ...new Set(
      items
        .map((company) => company.activePlanId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const activePlans =
    activePlanIds.length > 0
      ? await db.catalogPlan.findMany({
          where: { id: { in: activePlanIds }, teamId },
          select: {
            id: true,
            name: true,
            tier: true,
            price: true,
            annualPrice: true,
            billingInterval: true,
          },
        })
      : [];
  const activePlanById = new Map(activePlans.map((plan) => [plan.id, plan]));

  return c.json({
    data: items.map((company) => {
      const traits = asRecord(company.traits);
      const activePlan = company.activePlanId
        ? activePlanById.get(company.activePlanId) ?? null
        : null;
      const billingPeriod =
        normalizeBillingPeriod(traits.billingPeriod) ??
        (activePlan?.billingInterval &&
        Number(activePlan.billingInterval) >= YEARLY_INTERVAL
          ? "annual"
          : "monthly");

      return {
        ...company,
        traits: undefined,
        activePlan,
        billingPeriod,
      };
    }),
    count: items.length,
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  });
}

export async function createCompany(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  const { teamId } = auth;
  const environmentId = auth.activeEnvironmentId;
  if (!environmentId) {
    return apiError(c, "No workspace environment selected", {
      status: 409,
      code: "INVALID_INPUT",
    });
  }

  let body: {
    name: string;
    wallet?: string;
    email?: string;
    id?: string;
    traits?: Record<string, unknown>;
    logoUrl?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "Invalid JSON body", { status: 400, code: "INVALID_INPUT" });
  }

  if (!body.name) {
    return apiError(c, "name is required", { status: 400, code: "INVALID_INPUT" });
  }

  if (body.name.length > 128) {
    return apiError(c, "name too long", { status: 400, code: "INVALID_INPUT" });
  }

  if (body.email !== undefined) {
    if (body.email.length > 254) {
      return apiError(c, "email too long", { status: 400, code: "INVALID_INPUT" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return apiError(c, "Invalid email format", { status: 400, code: "INVALID_INPUT" });
    }
  }

  if (body.wallet !== undefined && (typeof body.wallet !== "string" || body.wallet.trim().length === 0 || body.wallet.length > 128)) {
    return apiError(c, "Invalid wallet address format", { status: 400, code: "INVALID_INPUT" });
  }

  if (body.id !== undefined && body.id.length > 64) {
    return apiError(c, "id too long", { status: 400, code: "INVALID_INPUT" });
  }

  const walletAddress = body.wallet?.toLowerCase();
  const email = body.email?.trim().toLowerCase();

  if (walletAddress) {
    const existing = await db.arcenCompany.findUnique({
      where: {
        teamId_environmentId_walletAddress: {
          teamId,
          environmentId,
          walletAddress,
        },
      },
    });
    if (existing) {
      return apiError(c, "Company with this wallet already exists", {
        status: 409,
        code: "CONFLICT",
      });
    }
  }

  const company = await db.arcenCompany.create({
    data: {
      teamId,
      environmentId,
      name: body.name,
      walletAddress,
      email,
      externalId: body.id,
      traits: (body.traits ?? {}) as unknown as Prisma.InputJsonValue,
      logoUrl: body.logoUrl,
    },
  });

  return c.json({ data: company }, 201 as any);
}
