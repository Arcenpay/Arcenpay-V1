import { describe, expect, it } from "vitest";
import {
  ActivationKeyService,
  generateActivationKeyCode,
  hashActivationKey,
  normalizeActivationKey,
} from "../../src/services/activation-key.service.js";
import { isPlatformAdminEmail, PLATFORM_ADMIN_EMAILS } from "../../src/config.js";
import type { PlatformActivationKey, PlatformActivationRedemption, Team } from "../../src/generated/client/client.js";

describe("ActivationKey Helpers", () => {
  it("generates a formatted activation key code matching ARCN-XXXX-XXXX-XXXX", () => {
    const code = generateActivationKeyCode();
    expect(code).toMatch(/^ARCN-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("normalizes keys by trimming and uppercasing", () => {
    const raw = "  arcn-a1b2-c3d4-e5f6  ";
    expect(normalizeActivationKey(raw)).toBe("ARCN-A1B2-C3D4-E5F6");
  });

  it("produces deterministic SHA-256 hashes", () => {
    const raw = "ARCN-1111-2222-3333";
    const hash1 = hashActivationKey(raw);
    const hash2 = hashActivationKey("  arcn-1111-2222-3333 ");
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });
});

describe("ActivationKeyService", () => {
  function createMockDb() {
    const keys: PlatformActivationKey[] = [];
    const redemptions: PlatformActivationRedemption[] = [];
    const teams: Partial<Team>[] = [
      {
        id: "team_alpha",
        name: "Alpha Corp",
        slug: "alpha-corp",
        platformTier: "FREE",
        isPlatformActivated: false,
        allowPlatformBilling: true,
        activationKeyId: null,
      },
      {
        id: "team_beta",
        name: "Beta Corp",
        slug: "beta-corp",
        platformTier: "FREE",
        isPlatformActivated: false,
        allowPlatformBilling: true,
        activationKeyId: null,
      },
    ];

    const mockDb: any = {
      platformActivationKey: {
        create: async ({ data }: any) => {
          const item: PlatformActivationKey = {
            id: `key_${Date.now()}_${Math.random()}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            key: data.key,
            keyHash: data.keyHash,
            name: data.name,
            recipientEmail: data.recipientEmail ?? null,
            recipientName: data.recipientName ?? null,
            tier: data.tier,
            allowPlatformBilling: data.allowPlatformBilling,
            maxUses: data.maxUses,
            usedCount: data.usedCount,
            status: data.status,
            expiresAt: data.expiresAt ?? null,
            revokedAt: null,
            revocationReason: null,
            createdById: data.createdById ?? null,
            notes: data.notes ?? null,
            metadata: data.metadata ?? null,
          };
          keys.push(item);
          return item;
        },
        findUnique: async ({ where }: any) => {
          if (where.keyHash) {
            return keys.find((k) => k.keyHash === where.keyHash) ?? null;
          }
          if (where.id) {
            return keys.find((k) => k.id === where.id) ?? null;
          }
          if (where.key) {
            return keys.find((k) => k.key === where.key) ?? null;
          }
          return null;
        },
        update: async ({ where, data }: any) => {
          const idx = keys.findIndex((k) => k.id === where.id);
          if (idx === -1) throw new Error("Key not found");
          const existing = keys[idx];
          const updated = {
            ...existing,
            ...data,
            usedCount: data.usedCount?.increment
              ? existing.usedCount + data.usedCount.increment
              : data.usedCount ?? existing.usedCount,
            updatedAt: new Date(),
          };
          keys[idx] = updated;
          return updated;
        },
        count: async ({ where }: any = {}) => {
          if (!where || Object.keys(where).length === 0) return keys.length;
          return keys.filter((k) => {
            if (where.status && k.status !== where.status) return false;
            if (where.tier && k.tier !== where.tier) return false;
            return true;
          }).length;
        },
        findMany: async () => keys,
      },
      platformActivationRedemption: {
        create: async ({ data }: any) => {
          const item: PlatformActivationRedemption = {
            id: `red_${Date.now()}_${Math.random()}`,
            createdAt: new Date(),
            activationKeyId: data.activationKeyId,
            teamId: data.teamId,
            userId: data.userId ?? null,
            userEmail: data.userEmail ?? null,
            walletAddress: data.walletAddress ?? null,
            ipAddress: data.ipAddress ?? null,
            userAgent: data.userAgent ?? null,
            metadata: data.metadata ?? null,
          };
          redemptions.push(item);
          return item;
        },
        findFirst: async ({ where }: any) => {
          return (
            redemptions.find(
              (r) =>
                r.activationKeyId === where.activationKeyId &&
                r.teamId === where.teamId
            ) ?? null
          );
        },
        count: async () => redemptions.length,
      },
      team: {
        findUnique: async ({ where }: any) => {
          const t = teams.find((item) => item.id === where.id);
          if (!t) return null;
          const k = t.activationKeyId ? keys.find((key) => key.id === t.activationKeyId) : null;
          return {
            ...t,
            activationKey: k ?? null,
          };
        },
        update: async ({ where, data }: any) => {
          const idx = teams.findIndex((t) => t.id === where.id);
          if (idx === -1) throw new Error("Team not found");
          const updated = { ...teams[idx], ...data };
          teams[idx] = updated;
          return updated;
        },
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          teams.forEach((t, i) => {
            if (t.activationKeyId === where.activationKeyId) {
              teams[i] = { ...t, ...data };
              count++;
            }
          });
          return { count };
        },
      },
    };

    return { mockDb, keys, redemptions, teams };
  }

  it("creates an activation key with custom tier and billing settings", async () => {
    const { mockDb } = createMockDb();
    const key = await ActivationKeyService.createActivationKey(
      {
        name: "Acme Corp Enterprise Pilot",
        tier: "PRO",
        allowPlatformBilling: false,
        maxUses: 1,
        recipientEmail: "cto@acme.com",
      },
      mockDb
    );

    expect(key.name).toBe("Acme Corp Enterprise Pilot");
    expect(key.tier).toBe("PRO");
    expect(key.allowPlatformBilling).toBe(false);
    expect(key.maxUses).toBe(1);
    expect(key.usedCount).toBe(0);
    expect(key.status).toBe("ACTIVE");
    expect(key.key).toMatch(/^ARCN-/);
  });

  it("verifies key validity, detecting non-existent, revoked, expired, and exhausted states", async () => {
    const { mockDb } = createMockDb();

    // 1. Non-existent
    const nonExistent = await ActivationKeyService.verifyActivationKey("ARCN-9999-9999-9999", mockDb);
    expect(nonExistent.valid).toBe(false);
    expect(nonExistent.reason).toBe("KEY_NOT_FOUND");

    // 2. Active key
    const active = await ActivationKeyService.createActivationKey(
      { name: "Active Key", tier: "PLUS", maxUses: 1 },
      mockDb
    );
    const validCheck = await ActivationKeyService.verifyActivationKey(active.key, mockDb);
    expect(validCheck.valid).toBe(true);
    expect(validCheck.key?.name).toBe("Active Key");
    expect(validCheck.key?.tier).toBe("PLUS");

    // 3. Expired key
    const expired = await ActivationKeyService.createActivationKey(
      {
        name: "Expired Key",
        tier: "FREE",
        expiresAt: new Date(Date.now() - 10000), // in the past
      },
      mockDb
    );
    const expiredCheck = await ActivationKeyService.verifyActivationKey(expired.key, mockDb);
    expect(expiredCheck.valid).toBe(false);
    expect(expiredCheck.reason).toBe("KEY_EXPIRED");
  });

  it("redeems an activation key, updating team tier, billing permission, and tracking usage", async () => {
    const { mockDb } = createMockDb();
    const key = await ActivationKeyService.createActivationKey(
      {
        name: "Alpha Key",
        tier: "PRO",
        allowPlatformBilling: false,
        maxUses: 1,
      },
      mockDb
    );

    const result = await ActivationKeyService.redeemActivationKey(
      {
        key: key.key,
        teamId: "team_alpha",
        userId: "user_1",
        userEmail: "admin@alpha.com",
      },
      mockDb
    );

    expect(result.success).toBe(true);
    expect(result.alreadyRedeemed).toBe(false);
    expect(result.team?.isPlatformActivated).toBe(true);
    expect(result.team?.platformTier).toBe("PRO");
    expect(result.team?.allowPlatformBilling).toBe(false);

    // Key should now be exhausted since maxUses was 1
    const verifyAfter = await ActivationKeyService.verifyActivationKey(key.key, mockDb);
    expect(verifyAfter.valid).toBe(false);
    expect(verifyAfter.reason).toBe("KEY_EXHAUSTED");

    // Attempting to redeem the same key by team_alpha again is idempotent
    const retryResult = await ActivationKeyService.redeemActivationKey(
      {
        key: key.key,
        teamId: "team_alpha",
      },
      mockDb
    );
    expect(retryResult.success).toBe(true);
    expect(retryResult.alreadyRedeemed).toBe(true);
  });

  it("revokes an activation key, immediately deactivating all teams that activated with it", async () => {
    const { mockDb, teams } = createMockDb();
    const key = await ActivationKeyService.createActivationKey(
      {
        name: "Multi-Team Key",
        tier: "PRO",
        allowPlatformBilling: true,
        maxUses: 5,
      },
      mockDb
    );

    // Redeem for team_alpha and team_beta
    await ActivationKeyService.redeemActivationKey({ key: key.key, teamId: "team_alpha" }, mockDb);
    await ActivationKeyService.redeemActivationKey({ key: key.key, teamId: "team_beta" }, mockDb);

    expect(teams.find((t) => t.id === "team_alpha")?.isPlatformActivated).toBe(true);
    expect(teams.find((t) => t.id === "team_beta")?.isPlatformActivated).toBe(true);

    // Revoke the key
    const revokeResult = await ActivationKeyService.revokeActivationKey(
      key.id,
      "Subscription cancelled by client",
      mockDb
    );

    expect(revokeResult.key.status).toBe("REVOKED");
    expect(revokeResult.affectedTeamsCount).toBe(2);

    // Both teams should now be deactivated
    expect(teams.find((t) => t.id === "team_alpha")?.isPlatformActivated).toBe(false);
    expect(teams.find((t) => t.id === "team_beta")?.isPlatformActivated).toBe(false);

    // Verification check should report KEY_REVOKED
    const checkRevoked = await ActivationKeyService.verifyActivationKey(key.key, mockDb);
    expect(checkRevoked.valid).toBe(false);
    expect(checkRevoked.reason).toBe("KEY_REVOKED");
  });

  it("reactivates a revoked key and restores workspace access", async () => {
    const { mockDb, teams } = createMockDb();
    const key = await ActivationKeyService.createActivationKey(
      {
        name: "Reactivatable Key",
        tier: "PLUS",
        maxUses: 3,
      },
      mockDb
    );

    await ActivationKeyService.redeemActivationKey({ key: key.key, teamId: "team_alpha" }, mockDb);
    await ActivationKeyService.revokeActivationKey(key.id, "Payment dispute", mockDb);

    expect(teams.find((t) => t.id === "team_alpha")?.isPlatformActivated).toBe(false);

    // Reactivate
    const reactivateResult = await ActivationKeyService.reactivateActivationKey(key.id, mockDb);
    expect(reactivateResult.key.status).toBe("ACTIVE");
    expect(reactivateResult.restoredTeamsCount).toBe(1);

    expect(teams.find((t) => t.id === "team_alpha")?.isPlatformActivated).toBe(true);
  });

  it("calculates accurate aggregate statistics across keys and redemptions", async () => {
    const { mockDb } = createMockDb();
    await ActivationKeyService.createActivationKey({ name: "Key 1", maxUses: 2 }, mockDb);
    await ActivationKeyService.createActivationKey({ name: "Key 2", maxUses: 1 }, mockDb);

    const stats = await ActivationKeyService.getActivationKeyStats(mockDb);
    expect(stats.totalKeys).toBe(2);
    expect(stats.activeKeys).toBe(2);
    expect(stats.revokedKeys).toBe(0);
    expect(stats.totalRedemptions).toBe(0);
  });

  it("detects expired keys, marks them EXPIRED in DB, and denies redemption", async () => {
    const { mockDb, keys } = createMockDb();
    const pastDate = new Date(Date.now() - 3600 * 1000); // 1 hour ago
    const key = await ActivationKeyService.createActivationKey(
      {
        name: "Expired Key Test",
        tier: "PRO",
        expiresAt: pastDate,
      },
      mockDb
    );

    // Verify should fail with KEY_EXPIRED and auto-update DB status
    const verifyRes = await ActivationKeyService.verifyActivationKey(key.key, mockDb);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.reason).toBe("KEY_EXPIRED");
    expect(keys.find((k) => k.id === key.id)?.status).toBe("EXPIRED");

    // Redeem should also fail with KEY_EXPIRED
    const redeemRes = await ActivationKeyService.redeemActivationKey(
      { key: key.key, teamId: "team_alpha" },
      mockDb
    );
    expect(redeemRes.success).toBe(false);
    expect(redeemRes.reason).toBe("KEY_EXPIRED");
  });

  it("accurately reports team activation status including revocation, expiry, and missing keys", async () => {
    const { mockDb, teams } = createMockDb();

    // 1. Team without activation key is not activated
    const unassignedStatus = await ActivationKeyService.getTeamActivationStatus("team_alpha", mockDb);
    expect(unassignedStatus?.isPlatformActivated).toBe(false);

    // 2. Activate with valid key
    const activeKey = await ActivationKeyService.createActivationKey(
      { name: "Active Key", tier: "PRO", maxUses: 2 },
      mockDb
    );
    await ActivationKeyService.redeemActivationKey({ key: activeKey.key, teamId: "team_alpha" }, mockDb);
    const activeStatus = await ActivationKeyService.getTeamActivationStatus("team_alpha", mockDb);
    expect(activeStatus?.isPlatformActivated).toBe(true);
    expect(activeStatus?.tier).toBe("PRO");

    // 3. Revoked key reflects as inactive
    await ActivationKeyService.revokeActivationKey(activeKey.id, "Audit failure", mockDb);
    const revokedStatus = await ActivationKeyService.getTeamActivationStatus("team_alpha", mockDb);
    expect(revokedStatus?.isPlatformActivated).toBe(false);
  });
});

describe("Platform Administrator Security", () => {
  it("authorizes admin@arcenpay.com and support@arcenpay.com as default platform administrators", () => {
    expect(isPlatformAdminEmail("admin@arcenpay.com")).toBe(true);
    expect(isPlatformAdminEmail("support@arcenpay.com")).toBe(true);
  });

  it("handles case-insensitivity and whitespace for admin email", () => {
    expect(isPlatformAdminEmail("  ADMIN@ARCENPAY.COM  ")).toBe(true);
    expect(isPlatformAdminEmail("Admin@ArcenPay.com")).toBe(true);
  });

  it("rejects unauthorized emails", () => {
    expect(isPlatformAdminEmail("hacker@malicious.com")).toBe(false);
    expect(isPlatformAdminEmail("user@example.com")).toBe(false);
    expect(isPlatformAdminEmail("stranger@otherdomain.com")).toBe(false);
  });

  it("safely rejects null or undefined emails", () => {
    expect(isPlatformAdminEmail(null)).toBe(false);
    expect(isPlatformAdminEmail(undefined)).toBe(false);
    expect(isPlatformAdminEmail("")).toBe(false);
  });

  it("includes admin@arcenpay.com in PLATFORM_ADMIN_EMAILS", () => {
    expect(PLATFORM_ADMIN_EMAILS.has("admin@arcenpay.com")).toBe(true);
  });
});

