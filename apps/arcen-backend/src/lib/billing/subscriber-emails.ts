import { db } from "../../db.js";
import { isValidAddress } from "@arcenpay/internal-core";

type SubscriberEmailRecord = {
  email: string;
  planId?: string | null;
};

/**
 * Normalizes a subscriber wallet for storage/lookup, accepting EVERY supported
 * family — EVM (0x…40 hex), Stellar (G…/C…/64-hex) and Solana (base58).
 *
 * EVM addresses are case-insensitive and lowercased; Stellar and Solana
 * addresses are case-sensitive and returned untouched. Returns null for
 * anything that isn't a valid address on a supported family.
 *
 * Previously this accepted only EVM addresses, so Stellar/Solana subscribers
 * could never register or look up an email.
 */
export function normalizeSubscriberWallet(
  walletAddress?: string | null,
): string | null {
  const trimmed = walletAddress?.trim();
  if (!trimmed) return null;
  const isKnownAddress =
    isValidAddress(trimmed, "evm") ||
    isValidAddress(trimmed, "stellar") ||
    isValidAddress(trimmed, "solana");
  if (!isKnownAddress) return null;
  return trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? trimmed.toLowerCase()
    : trimmed;
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
