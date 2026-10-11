import { randomBytes, createHash } from "node:crypto";
import { db } from "../db.js";
import { toPrismaJson } from "../utils/prisma-json.js";
import type { ActivationKeyStatus, PlatformTier } from "../generated/client/client.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CreateActivationKeyInput {
  name: string;
  key?: string;
  tier?: PlatformTier;
  allowPlatformBilling?: boolean;
  maxUses?: number;
  recipientEmail?: string;
  recipientName?: string;
  expiresAt?: Date | string;
  notes?: string;
  metadata?: Record<string, unknown>;
  createdById?: string;
}

export interface VerifyKeyResult {
  valid: boolean;
  reason?: "KEY_NOT_FOUND" | "KEY_REVOKED" | "KEY_EXPIRED" | "KEY_EXHAUSTED" | "INVALID_FORMAT";
  key?: {
    id: string;
    key: string;
    name: string;
    tier: PlatformTier;
    allowPlatformBilling: boolean;
    maxUses: number;
    usedCount: number;
    status: ActivationKeyStatus;
    expiresAt: Date | null;
    recipientEmail: string | null;
    recipientName: string | null;
  };
}

export interface RedeemKeyInput {
  key: string;
  teamId: string;
  userId?: string;
  userEmail?: string;
  walletAddress?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface RedeemKeyResult {
  success: boolean;
  error?: string;
  reason?: string;
  alreadyRedeemed?: boolean;
  activationKey?: {
    id: string;
    key: string;
    name: string;
    tier: PlatformTier;
    allowPlatformBilling: boolean;
  };
  team?: {
    id: string;
    name: string;
    platformTier: PlatformTier;
    isPlatformActivated: boolean;
    allowPlatformBilling: boolean;
  };
  redemptionId?: string;
}

export interface ListKeysFilters {
  search?: string;
  status?: ActivationKeyStatus;
  tier?: PlatformTier;
  limit?: number;
  offset?: number;
}

export interface ActivationKeyStats {
  totalKeys: number;
  activeKeys: number;
  revokedKeys: number;
  exhaustedKeys: number;
  expiredKeys: number;
  totalRedemptions: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a standard formatted activation key: ARCN-XXXX-XXXX-XXXX
 */
export function generateActivationKeyCode(): string {
  const bytes = randomBytes(6);
  const hex = bytes.toString("hex").toUpperCase();
  // Format into 3 chunks of 4: ARCN-1234-5678-90AB
  return `ARCN-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/**
 * Computes deterministic SHA-256 hash of the normalized activation key.
 */
export function hashActivationKey(rawKey: string): string {
  const normalized = rawKey.trim().toUpperCase();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Normalizes an activation key string (trims and converts to uppercase).
 */
export function normalizeActivationKey(rawKey: string): string {
  return rawKey.trim().toUpperCase();
}

// ── Service Methods ──────────────────────────────────────────────────────────

export class ActivationKeyService {
  /**
   * Creates a new Platform Activation Key.
   */
  static async createActivationKey(
    input: CreateActivationKeyInput,
    client = db
  ) {
    const rawKey = input.key ? normalizeActivationKey(input.key) : generateActivationKeyCode();
    const keyHash = hashActivationKey(rawKey);

    const expiresAt = input.expiresAt
      ? typeof input.expiresAt === "string"
        ? new Date(input.expiresAt)
        : input.expiresAt
      : null;

    const maxUses = input.maxUses && input.maxUses > 0 ? input.maxUses : 1;
    const tier = input.tier ?? "PRO";
    const allowPlatformBilling = input.allowPlatformBilling ?? true;

    return client.platformActivationKey.create({
      data: {
        key: rawKey,
        keyHash,
        name: input.name.trim(),
        recipientEmail: input.recipientEmail?.trim() || null,
        recipientName: input.recipientName?.trim() || null,
        tier,
        allowPlatformBilling,
        maxUses,
        usedCount: 0,
        status: "ACTIVE",
        expiresAt,
        createdById: input.createdById || null,
        notes: input.notes?.trim() || null,
        metadata: input.metadata ? toPrismaJson(input.metadata) : undefined,
      },
    });
  }

  /**
   * Verifies an activation key's validity without redeeming it.
   */
  static async verifyActivationKey(
    rawKey: string,
    client = db
  ): Promise<VerifyKeyResult> {
    if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) {
      return { valid: false, reason: "INVALID_FORMAT" };
    }

    const keyHash = hashActivationKey(rawKey);
    const keyRecord = await client.platformActivationKey.findUnique({
      where: { keyHash },
    });

    if (!keyRecord) {
      return { valid: false, reason: "KEY_NOT_FOUND" };
    }

    if (keyRecord.status === "REVOKED") {
      return { valid: false, reason: "KEY_REVOKED" };
    }

    if (keyRecord.status === "EXPIRED") {
      return { valid: false, reason: "KEY_EXPIRED" };
    }

    const now = new Date();
    if (keyRecord.expiresAt && keyRecord.expiresAt < now) {
      if (keyRecord.status === "ACTIVE") {
        await client.platformActivationKey.update({
          where: { id: keyRecord.id },
          data: { status: "EXPIRED" },
        }).catch(() => {});
      }
      return { valid: false, reason: "KEY_EXPIRED" };
    }

    if (keyRecord.usedCount >= keyRecord.maxUses || keyRecord.status === "EXHAUSTED") {
      if (keyRecord.status === "ACTIVE") {
        await client.platformActivationKey.update({
          where: { id: keyRecord.id },
          data: { status: "EXHAUSTED" },
        }).catch(() => {});
      }
      return { valid: false, reason: "KEY_EXHAUSTED" };
    }

    return {
      valid: true,
      key: {
        id: keyRecord.id,
        key: keyRecord.key,
        name: keyRecord.name,
        tier: keyRecord.tier,
        allowPlatformBilling: keyRecord.allowPlatformBilling,
        maxUses: keyRecord.maxUses,
        usedCount: keyRecord.usedCount,
        status: keyRecord.status,
        expiresAt: keyRecord.expiresAt,
        recipientEmail: keyRecord.recipientEmail,
        recipientName: keyRecord.recipientName,
      },
    };
  }

  /**
   * Redeems an activation key for a specific team.
   */
  static async redeemActivationKey(
    input: RedeemKeyInput,
    client = db
  ): Promise<RedeemKeyResult> {
    const { key: rawKey, teamId } = input;
    if (!rawKey || !teamId) {
      return { success: false, error: "Key and teamId are required." };
    }

    const keyHash = hashActivationKey(rawKey);
    const keyRecord = await client.platformActivationKey.findUnique({
      where: { keyHash },
    });

    if (!keyRecord) {
      return { success: false, error: "Activation key not found.", reason: "KEY_NOT_FOUND" };
    }

    if (keyRecord.status === "REVOKED") {
      return { success: false, error: "Activation key has been revoked.", reason: "KEY_REVOKED" };
    }

    if (keyRecord.status === "EXPIRED") {
      return { success: false, error: "Activation key has expired.", reason: "KEY_EXPIRED" };
    }

    // Check if this team already redeemed this key (idempotent success even if exhausted)
    const existingRedemption = await client.platformActivationRedemption.findFirst({
      where: {
        activationKeyId: keyRecord.id,
        teamId,
      },
    });

    if (existingRedemption) {
      const currentTeam = await client.team.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          name: true,
          platformTier: true,
          isPlatformActivated: true,
          allowPlatformBilling: true,
        },
      });

      return {
        success: true,
        alreadyRedeemed: true,
        activationKey: {
          id: keyRecord.id,
          key: keyRecord.key,
          name: keyRecord.name,
          tier: keyRecord.tier,
          allowPlatformBilling: keyRecord.allowPlatformBilling,
        },
        team: currentTeam ?? undefined,
        redemptionId: existingRedemption.id,
      };
    }

    // Now check expiration and capacity for new redemptions
    const now = new Date();
    if (keyRecord.expiresAt && keyRecord.expiresAt < now) {
      if (keyRecord.status === "ACTIVE") {
        await client.platformActivationKey.update({
          where: { id: keyRecord.id },
          data: { status: "EXPIRED" },
        }).catch(() => {});
      }
      return { success: false, error: "Activation key has expired.", reason: "KEY_EXPIRED" };
    }

    if (keyRecord.usedCount >= keyRecord.maxUses || keyRecord.status === "EXHAUSTED") {
      if (keyRecord.status === "ACTIVE") {
        await client.platformActivationKey.update({
          where: { id: keyRecord.id },
          data: { status: "EXHAUSTED" },
        }).catch(() => {});
      }
      return { success: false, error: "Activation key has reached its redemption limit.", reason: "KEY_EXHAUSTED" };
    }

    const keyData = keyRecord;

    // Create redemption & update key and team
    const newUsedCount = keyData.usedCount + 1;
    const isNowExhausted = newUsedCount >= keyData.maxUses;

    const [redemption, , updatedTeam] = await Promise.all([
      client.platformActivationRedemption.create({
        data: {
          activationKeyId: keyData.id,
          teamId,
          userId: input.userId || null,
          userEmail: input.userEmail || null,
          walletAddress: input.walletAddress || null,
          ipAddress: input.ipAddress || null,
          userAgent: input.userAgent || null,
          metadata: input.metadata ? toPrismaJson(input.metadata) : undefined,
        },
      }),
      client.platformActivationKey.update({
        where: { id: keyData.id },
        data: {
          usedCount: { increment: 1 },
          ...(isNowExhausted ? { status: "EXHAUSTED" } : {}),
        },
      }),
      client.team.update({
        where: { id: teamId },
        data: {
          isPlatformActivated: true,
          activationKeyId: keyData.id,
          platformTier: keyData.tier,
          allowPlatformBilling: keyData.allowPlatformBilling ?? true,
          tierExpiresAt: keyData.expiresAt ?? null,
        },
        select: {
          id: true,
          name: true,
          platformTier: true,
          isPlatformActivated: true,
          allowPlatformBilling: true,
        },
      }),
    ]);

    // Synchronize platform billing customer & subscription state immediately in live runtime
    if (client === db) {
      try {
        const { ensureWorkspacePlatformBilling } = await import("../lib/billing/platform-enrollment.js");
        await ensureWorkspacePlatformBilling({ workspaceTeamId: teamId });
      } catch (billingErr) {
        // Graceful fallback if provider is not yet bootstrapped
        console.warn("[activation-key] Immediate platform billing sync deferred:", billingErr);
      }
    }

    return {
      success: true,
      alreadyRedeemed: false,
      activationKey: {
        id: keyData.id,
        key: keyData.key,
        name: keyData.name,
        tier: keyData.tier,
        allowPlatformBilling: keyData.allowPlatformBilling ?? true,
      },
      team: updatedTeam,
      redemptionId: redemption.id,
    };
  }

  /**
   * Revokes an activation key, immediately deactivating all teams that activated with it.
   */
  static async revokeActivationKey(
    id: string,
    reason?: string,
    client = db
  ) {
    const key = await client.platformActivationKey.findUnique({
      where: { id },
    });
    if (!key) {
      throw new Error(`Activation key with id '${id}' not found.`);
    }

    const now = new Date();
    const [revokedKey, affectedTeams] = await Promise.all([
      client.platformActivationKey.update({
        where: { id },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revocationReason: reason?.trim() || null,
        },
      }),
      client.team.updateMany({
        where: { activationKeyId: id },
        data: {
          isPlatformActivated: false,
        },
      }),
    ]);

    return {
      key: revokedKey,
      affectedTeamsCount: affectedTeams.count,
    };
  }

  /**
   * Reactivates a revoked activation key and restores workspace activation.
   */
  static async reactivateActivationKey(
    id: string,
    client = db
  ) {
    const key = await client.platformActivationKey.findUnique({
      where: { id },
    });
    if (!key) {
      throw new Error(`Activation key with id '${id}' not found.`);
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      throw new Error("Cannot reactivate an expired activation key.");
    }

    const nextStatus: ActivationKeyStatus =
      key.usedCount >= key.maxUses ? "EXHAUSTED" : "ACTIVE";

    const [restoredKey, restoredTeams] = await Promise.all([
      client.platformActivationKey.update({
        where: { id },
        data: {
          status: nextStatus,
          revokedAt: null,
          revocationReason: null,
        },
      }),
      client.team.updateMany({
        where: { activationKeyId: id },
        data: {
          isPlatformActivated: true,
        },
      }),
    ]);

    return {
      key: restoredKey,
      restoredTeamsCount: restoredTeams.count,
    };
  }

  /**
   * Lists activation keys with optional filtering and pagination.
   */
  static async listActivationKeys(
    filters: ListKeysFilters = {},
    client = db
  ) {
    const { search, status, tier, limit = 50, offset = 0 } = filters;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (tier) where.tier = tier;

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { key: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { recipientEmail: { contains: q, mode: "insensitive" } },
        { recipientName: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      client.platformActivationKey.count({ where }),
      client.platformActivationKey.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          _count: {
            select: {
              redemptions: true,
              teams: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      items: items.map((k) => ({
        ...k,
        redemptionsCount: k._count.redemptions,
        teamsCount: k._count.teams,
      })),
    };
  }

  /**
   * Gets a single activation key with all redemption details and team info.
   */
  static async getActivationKeyById(
    id: string,
    client = db
  ) {
    return client.platformActivationKey.findUnique({
      where: { id },
      include: {
        redemptions: {
          orderBy: { createdAt: "desc" },
          include: {
            team: {
              select: {
                id: true,
                name: true,
                slug: true,
                platformTier: true,
                isPlatformActivated: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Aggregates stats for the admin dashboard.
   */
  static async getActivationKeyStats(
    client = db
  ): Promise<ActivationKeyStats> {
    const now = new Date();
    const [totalKeys, activeKeys, revokedKeys, exhaustedKeys, expiredKeys, totalRedemptions] =
      await Promise.all([
        client.platformActivationKey.count(),
        client.platformActivationKey.count({ where: { status: "ACTIVE" } }),
        client.platformActivationKey.count({ where: { status: "REVOKED" } }),
        client.platformActivationKey.count({ where: { status: "EXHAUSTED" } }),
        client.platformActivationKey.count({
          where: {
            status: "ACTIVE",
            expiresAt: { lt: now },
          },
        }),
        client.platformActivationRedemption.count(),
      ]);

    return {
      totalKeys,
      activeKeys,
      revokedKeys,
      exhaustedKeys,
      expiredKeys,
      totalRedemptions,
    };
  }

  /**
   * Gets the authoritative activation status of a team.
   */
  static async getTeamActivationStatus(
    teamId: string,
    client = db
  ) {
    const team = await client.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        slug: true,
        platformTier: true,
        isPlatformActivated: true,
        allowPlatformBilling: true,
        activationKeyId: true,
        // NOTE: `key` is deliberately NOT selected — this value is returned to
        // the caller, and a team's redeemable activation key must never be
        // echoed back (it is a credential, not display metadata).
        activationKey: {
          select: {
            id: true,
            name: true,
            tier: true,
            allowPlatformBilling: true,
            status: true,
            expiresAt: true,
          },
        },
      },
    });

    if (!team) return null;

    // Check if key was revoked or expired after activation, or if team has no key
    let effectiveActivated = Boolean(team.isPlatformActivated);
    const now = new Date();
    if (team.activationKey) {
      if (team.activationKey.status === "REVOKED") {
        effectiveActivated = false;
      } else if (
        team.activationKey.status === "EXPIRED" ||
        (team.activationKey.expiresAt && team.activationKey.expiresAt < now)
      ) {
        effectiveActivated = false;
        if (team.activationKey.status === "ACTIVE") {
          await client.platformActivationKey.update({
            where: { id: team.activationKey.id },
            data: { status: "EXPIRED" },
          }).catch(() => {});
        }
      }
    } else if (!team.activationKeyId) {
      // Team has no activation key assigned
      effectiveActivated = false;
    }

    // Auto-heal/sync team in DB if effective status is false
    if (team.isPlatformActivated && !effectiveActivated) {
      await client.team.update({
        where: { id: team.id },
        data: { isPlatformActivated: false },
      }).catch(() => {});
    }

    return {
      teamId: team.id,
      name: team.name,
      slug: team.slug,
      tier: team.platformTier,
      isPlatformActivated: effectiveActivated,
      allowPlatformBilling: team.allowPlatformBilling,
      activationKey: team.activationKey,
    };
  }
}
