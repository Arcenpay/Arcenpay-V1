import type { Prisma } from "@/src/generated/prisma/client";
import { db } from "@/lib/db";
import { toPrismaJson } from "@/lib/prisma-json";

type AddOnGrantDb = Pick<
  typeof db,
  "companyAddOnGrant" | "arcenCompany" | "$transaction"
>;

function isGrantCurrentlyActive(grant: {
  status: string;
  expiresAt?: Date | null;
}): boolean {
  if (grant.status !== "ACTIVE") return false;
  return !grant.expiresAt || grant.expiresAt.getTime() > Date.now();
}

export function normalizeAddOnIdCache(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))];
}

export async function listActiveCompanyAddOnIds(
  teamId: string,
  companyId: string,
  client: AddOnGrantDb = db,
): Promise<string[]> {
  const grants = await client.companyAddOnGrant.findMany({
    where: { teamId, companyId },
    select: {
      catalogAddOnId: true,
      status: true,
      expiresAt: true,
    },
    orderBy: [{ grantedAt: "desc" }],
  });

  return [...new Set(grants.filter(isGrantCurrentlyActive).map((grant) => grant.catalogAddOnId))];
}

export async function syncCompanyAddOnCache(
  teamId: string,
  companyId: string,
  client: AddOnGrantDb = db,
): Promise<string[]> {
  const activeAddOnIds = await listActiveCompanyAddOnIds(teamId, companyId, client);
  await client.arcenCompany.update({
    where: { id: companyId },
    data: { activeAddOnIds } as unknown as Prisma.ArcenCompanyUpdateInput,
  });
  return activeAddOnIds;
}

export async function grantCompanyAddOn(input: {
  teamId: string;
  companyId: string;
  catalogAddOnId: string;
  source:
    | "ADMIN"
    | "ADDON_PURCHASE"
    | "PAYMENT_LINK"
    | "INVOICE"
    | "SUBSCRIPTION_UPSELL";
  paymentId?: string | null;
  checkoutSessionId?: string | null;
  expiresAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, unknown>;
}, client: AddOnGrantDb = db) {
  const existing = await client.companyAddOnGrant.findFirst({
    where: {
      teamId: input.teamId,
      companyId: input.companyId,
      catalogAddOnId: input.catalogAddOnId,
      status: "ACTIVE",
    },
    orderBy: [{ grantedAt: "desc" }],
  });

  const grant = existing
    ? await client.companyAddOnGrant.update({
        where: { id: existing.id },
        data: {
          source: input.source,
          paymentId: input.paymentId ?? undefined,
          checkoutSessionId: input.checkoutSessionId ?? undefined,
          expiresAt: input.expiresAt ?? null,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
          cancelledAt: null,
          metadata: input.metadata ? toPrismaJson(input.metadata) : undefined,
        },
      })
    : await client.companyAddOnGrant.create({
        data: {
          teamId: input.teamId,
          companyId: input.companyId,
          catalogAddOnId: input.catalogAddOnId,
          source: input.source,
          paymentId: input.paymentId ?? null,
          checkoutSessionId: input.checkoutSessionId ?? null,
          expiresAt: input.expiresAt ?? null,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
          metadata: input.metadata ? toPrismaJson(input.metadata) : undefined,
        },
      });

  await syncCompanyAddOnCache(input.teamId, input.companyId, client);
  return grant;
}

export async function updateCompanyAddOnGrant(input: {
  teamId: string;
  grantId: string;
  status?: "ACTIVE" | "CANCELLED" | "REVOKED" | "EXPIRED";
  cancelAtPeriodEnd?: boolean;
  expiresAt?: Date | null;
  cancelledAt?: Date | null;
  metadata?: Record<string, unknown>;
}, client: AddOnGrantDb = db) {
  const grant = await client.companyAddOnGrant.findFirst({
    where: { id: input.grantId, teamId: input.teamId },
    select: { id: true, companyId: true },
  });
  if (!grant) {
    throw new Error("Add-on grant not found");
  }

  const updated = await client.companyAddOnGrant.update({
    where: { id: grant.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.cancelAtPeriodEnd !== undefined
        ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd }
        : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.cancelledAt !== undefined
        ? { cancelledAt: input.cancelledAt }
        : {}),
      ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
    },
  });

  await syncCompanyAddOnCache(input.teamId, grant.companyId, client);
  return updated;
}

export async function getCompanyAddOnGrants(teamId: string, companyId: string) {
  return db.companyAddOnGrant.findMany({
    where: { teamId, companyId },
    include: {
      catalogAddOn: {
        select: {
          id: true,
          name: true,
          code: true,
          billingType: true,
          saleMode: true,
          price: true,
          billingIntervalDays: true,
          acceptedToken: true,
        },
      },
      payment: {
        select: {
          id: true,
          status: true,
          txHash: true,
          amount: true,
          currency: true,
        },
      },
      checkoutSession: {
        select: {
          id: true,
          status: true,
          txHash: true,
          paidAt: true,
        },
      },
    },
    orderBy: [{ grantedAt: "desc" }],
  });
}

export async function listAddOnGrantCompanies(teamId: string, catalogAddOnId: string) {
  return db.companyAddOnGrant.findMany({
    where: { teamId, catalogAddOnId },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          email: true,
          walletAddress: true,
          externalId: true,
        },
      },
      payment: {
        select: { id: true, txHash: true, amount: true, currency: true },
      },
    },
    orderBy: [{ grantedAt: "desc" }],
  });
}
