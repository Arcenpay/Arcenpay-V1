/**
 * GET    /api/v1/companies/:id   — Get company detail (entitlements, plan, overrides, users)
 * PATCH  /api/v1/companies/:id   — Update company traits / plan assignment
 * DELETE /api/v1/companies/:id   — Delete company
 *
 * Authorization: Bearer api_xxx
 */

import type { Context } from "hono";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import { db } from "../../db.js";
import { resolveEntitlementResults } from "../../lib/entitlements/entitlements.js";
import type { Prisma } from "../../generated/client/client.js";
import { getCompanyAddOnGrants } from "../../lib/companies/addon-grants.js";

export async function GET(c: Context) {
  const ctx = await requireAnyAuth(c);
  if (isAnyAuthError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const id = c.req.param("id");
  const { teamId } = ctx;

  const company = await db.arcenCompany.findFirst({
    where: { id, teamId },
    include: {
      users: {
        select: {
          id: true,
          name: true,
          email: true,
          walletAddress: true,
          lastSeenAt: true,
        },
        orderBy: { lastSeenAt: "desc" },
        take: 20,
      },
      overrides: {
        select: {
          id: true,
          featureKey: true,
          value: true,
          reason: true,
          createdAt: true,
        },
      },
    },
  });

  if (!company) {
    return c.json({ error: "Company not found" }, 404 as any);
  }

  // Get active plan details if assigned
  let activePlan = null;
  if (company.activePlanId) {
    activePlan = await db.catalogPlan.findUnique({
      where: { id: company.activePlanId },
      select: {
        id: true,
        name: true,
        tier: true,
        price: true,
        billingInterval: true,
      },
    });
  }

  const companyKeys = {
    id: company.externalId ?? undefined,
    wallet: company.walletAddress ?? undefined,
    email: company.email ?? undefined,
  };
  const entitlementResults = await resolveEntitlementResults({
    teamId,
    companyKeys,
  });
  const addOnGrants = await getCompanyAddOnGrants(teamId, company.id);
  const activeAddOnIds = [
    ...new Set(
      addOnGrants
        .filter(
          (grant) =>
            grant.status === "ACTIVE" &&
            (!grant.expiresAt || grant.expiresAt > new Date()),
        )
        .map((grant) => grant.catalogAddOnId),
    ),
  ];

  const entitlements = entitlementResults.entitlements.map((result) => ({
    featureKey: result.key,
    value: result.enabled,
    reason: result.reason,
    allocation: result.allocation,
    usage: result.usage,
    exceeded: result.exceeded,
  }));

  return c.json({
    data: {
      id: company.id,
      name: company.name,
      walletAddress: company.walletAddress,
      email: company.email,
      externalId: company.externalId,
      logoUrl: company.logoUrl,
      traits: company.traits,
      activePlan,
      activeAddOnIds,
      addOnGrants: addOnGrants.map((grant) => ({
        id: grant.id,
        status: grant.status,
        source: grant.source,
        grantedAt: grant.grantedAt,
        expiresAt: grant.expiresAt,
        cancelAtPeriodEnd: grant.cancelAtPeriodEnd,
        cancelledAt: grant.cancelledAt,
        addOn: grant.catalogAddOn,
        payment: grant.payment,
        checkoutSession: grant.checkoutSession,
      })),
      createdAt: company.createdAt,
      lastSeenAt: company.lastSeenAt,
      users: company.users,
      overrides: company.overrides,
      entitlements,
    },
  });
}

export async function PATCH(c: Context) {
  const ctx = await requireAnyAuth(c);
  if (isAnyAuthError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const id = c.req.param("id");
  const { teamId } = ctx;

  let body: {
    name?: string;
    traits?: Record<string, unknown>;
    activePlanId?: string | null;
    activeAddOnIds?: string[];
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  // ── Field length and type validation ────────────────────────
  if (body.name !== undefined && body.name.length > 128) {
    return c.json({ error: "name too long" }, 400 as any);
  }
  if (
    body.traits !== undefined &&
    (typeof body.traits !== "object" ||
      body.traits === null ||
      Array.isArray(body.traits))
  ) {
    return c.json({ error: "traits must be a plain object" }, 400 as any);
  }

  const company = await db.arcenCompany.findFirst({
    where: { id, teamId },
  });

  if (!company) {
    return c.json({ error: "Company not found" }, 404 as any);
  }

  const updated = await db.arcenCompany.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.traits !== undefined
        ? {
            traits: {
              ...(company.traits as Record<string, unknown>),
              ...body.traits,
            } as unknown as Prisma.InputJsonValue,
          }
        : {}),
      ...(body.activePlanId !== undefined
        ? { activePlanId: body.activePlanId }
        : {}),
      ...(body.activeAddOnIds !== undefined
        ? { activeAddOnIds: body.activeAddOnIds }
        : {}),
    },
  });

  return c.json({ data: updated });
}

export async function DELETE(c: Context) {
  const ctx = await requireAnyAuth(c);
  if (isAnyAuthError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const id = c.req.param("id");
  const { teamId } = ctx;

  const company = await db.arcenCompany.findFirst({ where: { id, teamId } });
  if (!company) {
    return c.json({ error: "Company not found" }, 404 as any);
  }

  await db.arcenCompany.delete({ where: { id } });
  return c.json({ ok: true });
}
