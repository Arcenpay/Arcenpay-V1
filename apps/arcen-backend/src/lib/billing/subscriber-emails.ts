import { db } from "../../db.js";

type SubscriberEmailRecord = {
  email: string;
  planId?: string | null;
};

export function normalizeSubscriberWallet(
  walletAddress?: string | null,
): string | null {
  const normalized = walletAddress?.trim().toLowerCase();
  return normalized && /^0x[0-9a-f]{40}$/.test(normalized)
    ? normalized
    : null;
}

export function buildSubscriberEmailScopeKey(input: {
  teamId?: string | null;
  environmentId?: string | null;
}): string {
  const teamId = input.teamId?.trim();
  if (!teamId) return "legacy";
  return `${teamId}:${input.environmentId?.trim() || "default"}`;
}

export async function upsertScopedSubscriberEmail(input: {
  teamId?: string | null;
  environmentId?: string | null;
  companyId?: string | null;
  walletAddress?: string | null;
  email?: string | null;
  planId?: string | null;
}): Promise<SubscriberEmailRecord | null> {
  const walletAddress = normalizeSubscriberWallet(input.walletAddress);
  const email = input.email?.trim().toLowerCase();
  if (!walletAddress || !email) return null;

  const scopeKey = buildSubscriberEmailScopeKey(input);
  return db.subscriberEmail.upsert({
    where: {
      scopeKey_walletAddress: {
        scopeKey,
        walletAddress,
      },
    },
    update: {
      email,
      planId: input.planId ?? null,
      teamId: input.teamId ?? null,
      environmentId: input.environmentId ?? null,
      companyId: input.companyId ?? null,
    },
    create: {
      scopeKey,
      teamId: input.teamId ?? null,
      environmentId: input.environmentId ?? null,
      companyId: input.companyId ?? null,
      walletAddress,
      email,
      planId: input.planId ?? null,
    },
    select: { email: true, planId: true },
  });
}

export async function findScopedSubscriberEmail(input: {
  teamId?: string | null;
  environmentId?: string | null;
  walletAddress?: string | null;
}): Promise<SubscriberEmailRecord | null> {
  const walletAddress = normalizeSubscriberWallet(input.walletAddress);
  if (!walletAddress) return null;

  const scopeKey = buildSubscriberEmailScopeKey(input);
  const scopedRecord = await db.subscriberEmail.findUnique({
    where: {
      scopeKey_walletAddress: {
        scopeKey,
        walletAddress,
      },
    },
    select: { email: true, planId: true },
  });
  if (scopedRecord) return scopedRecord;

  if (scopeKey === "legacy") return null;

  return db.subscriberEmail.findFirst({
    where: {
      scopeKey: "legacy",
      teamId: null,
      walletAddress,
    },
    select: { email: true, planId: true },
    orderBy: { updatedAt: "desc" },
  });
}
