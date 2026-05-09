import {
  resolveEntitlementResults,
  resolveEntitlementResult,
  type ResolvedEntitlementResults,
} from '../lib/entitlements/entitlements';
import {
  evaluateFlag,
  evaluateFlags,
  resolveCompany,
  resolveUser,
  type CompanyKeys,
  type UserKeys,
  type FlagCheckResult,
} from '../lib/entitlements/flag-engine';
import {
  getCachedFlag,
  setCachedFlag,
  invalidateFlagCache,
} from '../lib/entitlements/flag-cache';
import { syncEntitlementsToFlagRules, type PlanEntitlement } from '../lib/entitlements/sync-entitlements';

export class EntitlementError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "EntitlementError";
  }
}

export class EntitlementService {
  // ── Entitlement Resolution ─────────────────────────────────────────────────

  async resolveEntitlementResults(
    input: Parameters<typeof resolveEntitlementResults>[0],
  ): Promise<ResolvedEntitlementResults> {
    try {
      return await resolveEntitlementResults(input);
    } catch (error) {
      throw new EntitlementError(
        error instanceof Error ? error.message : "Failed to resolve entitlements",
        500,
        "ENTITLEMENT_RESOLUTION_FAILED",
      );
    }
  }

  async resolveEntitlementResult(
    input: Parameters<typeof resolveEntitlementResult>[0],
  ) {
    try {
      return await resolveEntitlementResult(input);
    } catch (error) {
      throw new EntitlementError(
        error instanceof Error ? error.message : "Failed to resolve entitlement",
        500,
        "ENTITLEMENT_RESOLUTION_FAILED",
      );
    }
  }

  // ── Flag Engine ────────────────────────────────────────────────────────────

  async evaluateFlag(
    teamId: string,
    featureKey: string,
    companyKeys: CompanyKeys,
    userKeys?: UserKeys,
  ): Promise<FlagCheckResult> {
    try {
      return await evaluateFlag(teamId, featureKey, companyKeys, userKeys);
    } catch (error) {
      throw new EntitlementError(
        error instanceof Error ? error.message : "Failed to evaluate flag",
        500,
        "FLAG_EVALUATION_FAILED",
      );
    }
  }

  async evaluateFlags(
    teamId: string,
    featureKeys: string[],
    companyKeys: CompanyKeys,
    userKeys?: UserKeys,
  ): Promise<FlagCheckResult[]> {
    try {
      return await evaluateFlags(teamId, featureKeys, companyKeys, userKeys);
    } catch (error) {
      throw new EntitlementError(
        error instanceof Error ? error.message : "Failed to evaluate flags",
        500,
        "FLAG_EVALUATION_FAILED",
      );
    }
  }

  async resolveCompany(teamId: string, keys: CompanyKeys) {
    return resolveCompany(teamId, keys);
  }

  async resolveUser(teamId: string, keys: UserKeys) {
    return resolveUser(teamId, keys);
  }

  // ── Flag Cache ─────────────────────────────────────────────────────────────

  async getCachedFlag(key: string) {
    return getCachedFlag(key);
  }

  async setCachedFlag(key: string, value: unknown, ttlSeconds: number) {
    await setCachedFlag(key, value, ttlSeconds);
  }

  invalidateFlagCache(pattern: string) {
    invalidateFlagCache(pattern);
  }

  // ── Sync Entitlements ─────────────────────────────────────────────────────

  async syncEntitlementsToFlagRules(
    teamId: string,
    planId: string,
    entitlements: PlanEntitlement[],
  ) {
    try {
      await syncEntitlementsToFlagRules(teamId, planId, entitlements);
    } catch (error) {
      throw new EntitlementError(
        error instanceof Error ? error.message : "Failed to sync entitlements to flag rules",
        500,
        "ENTITLEMENT_SYNC_FAILED",
      );
    }
  }
}

export const entitlementService = new EntitlementService();
