/**
 * GET /api/v1/components/:id/render
 *
 * Returns component config + company-specific data (plan, usage, entitlements)
 * for rendering an embeddable ArcenEmbed component.
 *
 * Requires: Authorization: Bearer <access_token> (short-lived embed token)
 */

import type { Context } from "hono";
import { createPublicClient, http, parseEventLogs } from "viem";
import {
  getContractAddresses,
  PlanFactoryABI,
  SubscriptionRegistryABI,
} from "@arcenpay/internal-core";
import type { ComponentInvoiceSummary } from "@arcenpay/internal-core";
import { db } from "../../db.js";
import { resolveEntitlementResults } from "../../lib/entitlements/entitlements.js";
import { getRpcUrl } from "../../config.js";
import { DEFAULT_CHAIN_ID } from "../../lib/platform/default-chain.js";
import {
  listAllMetadataEntitlements,
  listMetadataEntitlements,
} from "../../lib/catalog/catalog-entitlements.js";
import { normalizeComponentDesign } from "../../lib/catalog/component-design.js";
import {
  extractEmbedAccessToken,
  resolveEmbedAccessToken,
} from "../../lib/entitlements/embed-access-token.js";
import { ensureInvoicePdfForTeam } from "../../lib/billing/invoice-documents.js";
import { upsertSubscriptionLedgerState } from "../../lib/billing/billing-ledger.js";
import { findScopedSubscriberEmail } from "../../lib/billing/subscriber-emails.js";
import { getLatestSubscriptionChangeRequest } from "../../lib/billing/subscription-change-requests.js";
import { corsHeaders } from "../../middleware/cors.js";
import { toPrismaJson } from "../../utils/prisma-json.js";

const PERIOD_END_REPAIR_TOLERANCE_MS = 5 * 60 * 1000;

// ─── Normalization helpers ────────────────────────────────────────────────────

function normalizeElementType(type: string): string {
  const map: Record<string, string> = {
    "plan-manager": "planManager",
    "included-features": "includedFeatures",
    "metered-features": "meteredFeatures",
    "next-bill-due": "nextBillDue",
    "payment-method": "paymentMethod",
    "pricing-table": "plansTable",
    invoices: "invoices",
    unsubscribe: "unsubscribe",
    text: "text",
    button: "button",
    "billing-history": "billingHistory",
  };
  return map[type] ?? type;
}

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

function deriveBillingPeriodFromInterval(
  billingInterval: unknown,
): "monthly" | "annual" {
  return typeof billingInterval === "number" && billingInterval >= 31_536_000
    ? "annual"
    : "monthly";
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveDeferredBillingPeriodRepair(input: {
  transition: Record<string, unknown> | null;
  activeBillingPeriod: "monthly" | "annual" | null;
  liveCurrentPeriodEnd: string | null;
}):
  | {
      previousBillingPeriod: "monthly" | "annual";
      targetBillingPeriod: "monthly" | "annual";
      effectiveAt: string;
    }
  | null {
  const transition = input.transition;
  if (!transition) return null;
  if (transition.changeType !== "upgrade" || transition.stage !== "applied") {
    return null;
  }
  if (transition.mode !== "immediate_prorated_upgrade") return null;

  const previousPlanId =
    typeof transition.previousPlanId === "string"
      ? transition.previousPlanId
      : null;
  const targetPlanId =
    typeof transition.targetPlanId === "string" ? transition.targetPlanId : null;
  if (!previousPlanId || !targetPlanId || previousPlanId !== targetPlanId) {
    return null;
  }

  const previousBillingPeriod = normalizeBillingPeriod(
    transition.previousBillingPeriod,
  );
  const targetBillingPeriod = normalizeBillingPeriod(
    transition.targetBillingPeriod,
  );
  if (
    !previousBillingPeriod ||
    !targetBillingPeriod ||
    previousBillingPeriod === targetBillingPeriod ||
    input.activeBillingPeriod !== targetBillingPeriod
  ) {
    return null;
  }

  const livePeriodEnd = parseIsoDate(input.liveCurrentPeriodEnd);
  const prorationPeriodEnd = parseIsoDate(
    asRecord(asRecord(transition.metadata).proration).currentPeriodEnd,
  );
  if (!livePeriodEnd || !prorationPeriodEnd) return null;

  if (
    livePeriodEnd.getTime() >
    prorationPeriodEnd.getTime() + PERIOD_END_REPAIR_TOLERANCE_MS
  ) {
    return null;
  }

  return {
    previousBillingPeriod,
    targetBillingPeriod,
    effectiveAt: livePeriodEnd.toISOString(),
  };
}

function deriveVisiblePlanIds(config: {
  restrictLivePlans?: boolean;
  livePlanIds?: string[];
  initialPlan?: string | null;
  fallbackPlan?: string | null;
} | null): string[] | null {
  if (!config) return null;
  if (config.restrictLivePlans) {
    return Array.isArray(config.livePlanIds) ? config.livePlanIds : [];
  }
  return null;
}

type ComponentPlanMetadataEntitlement = {
  featureKey: string;
  featureName?: string;
  type?: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value?: boolean | number | null;
  valueUnit?: string | null;
  enabled?: boolean;
  featureType?: "boolean" | "event" | "trait";
  icon?: string | null;
};

type ComponentPlanMetadataCreditGrant = {
  creditTypeId: string;
  amount: number;
  name?: string | null;
  code?: string | null;
  unitName?: string | null;
};

function listComponentPlanMetadataEntitlements(
  metadata: unknown,
  billingPeriod: "monthly" | "annual" = "monthly",
): ComponentPlanMetadataEntitlement[] {
  return listMetadataEntitlements(metadata, billingPeriod).map((entry) => {
    const candidate = entry as unknown as Record<string, unknown>;

    return {
      featureKey: entry.featureKey,
      featureName:
        typeof candidate.featureName === "string"
          ? candidate.featureName
          : undefined,
      type:
        candidate.type === "NUMERIC" || candidate.type === "UNLIMITED"
          ? candidate.type
          : "BOOLEAN",
      value:
        typeof candidate.value === "number" || typeof candidate.value === "boolean"
          ? candidate.value
          : null,
      valueUnit:
        typeof candidate.valueUnit === "string" ? candidate.valueUnit : null,
      enabled: entry.enabled ?? true,
      featureType:
        candidate.featureType === "event" || candidate.featureType === "trait"
          ? candidate.featureType
          : "boolean",
      icon: typeof candidate.icon === "string" ? candidate.icon : null,
    };
  });
}

function listComponentPlanMetadataCreditGrants(
  metadata: unknown,
): ComponentPlanMetadataCreditGrant[] {
  const raw = asRecord(metadata).creditGrants;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(
      (
        entry,
      ): entry is {
        creditTypeId: string;
        amount: number | string;
        name?: string | null;
        code?: string | null;
        unitName?: string | null;
      } =>
        Boolean(
          entry &&
            typeof entry === "object" &&
            typeof (entry as { creditTypeId?: unknown }).creditTypeId ===
              "string",
        ),
    )
    .map((entry) => {
      const numericAmount =
        typeof entry.amount === "number"
          ? entry.amount
          : Number.parseFloat(String(entry.amount));
      return {
        creditTypeId: entry.creditTypeId,
        amount: Number.isFinite(numericAmount) ? numericAmount : 0,
        name: typeof entry.name === "string" ? entry.name : null,
        code: typeof entry.code === "string" ? entry.code : null,
        unitName: typeof entry.unitName === "string" ? entry.unitName : null,
      };
    })
    .filter((entry) => entry.amount > 0);
}

function hydratePlanMetadataWithCreditGrants(
  metadata: unknown,
  creditsById: Map<
    string,
    { id: string; name: string; code: string; unitName: string }
  >,
): Record<string, unknown> | null {
  const record = asRecord(metadata);
  const creditGrants = listComponentPlanMetadataCreditGrants(metadata);
  if (Object.keys(record).length === 0 && creditGrants.length === 0) {
    return null;
  }

  return {
    ...record,
    creditGrants: creditGrants.map((grant) => {
      const creditType = creditsById.get(grant.creditTypeId);
      return {
        ...grant,
        name: creditType?.name ?? grant.name ?? grant.creditTypeId,
        code: creditType?.code ?? grant.code ?? null,
        unitName: creditType?.unitName ?? grant.unitName ?? "credits",
      };
    }),
  };
}

function toCreditGrantEntitlements(
  creditGrants: ComponentPlanMetadataCreditGrant[],
): Array<Record<string, unknown>> {
  return creditGrants.map((grant) => ({
    featureKey: `credit:${grant.code ?? grant.creditTypeId}`,
    name: grant.name ?? grant.creditTypeId,
    value: grant.amount,
    featureType: "credit",
    usage: 0,
    exceeded: false,
    unitSingular: grant.unitName ?? "credit",
    unitPlural: grant.unitName ?? "credits",
    icon: null,
  }));
}

function readInvoiceCustomerName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const customerName = (metadata as Record<string, unknown>).customerName;
  return typeof customerName === "string" && customerName.trim()
    ? customerName.trim()
    : null;
}

function readInvoiceTxHash(metadata: unknown): string | null {
  const txHash = asRecord(metadata).txHash;
  return typeof txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(txHash)
    ? txHash.toLowerCase()
    : null;
}

function readSubscriptionActivationInvoiceKey(metadata: unknown): string | null {
  const record = asRecord(metadata);
  const mode = typeof record.mode === "string" ? record.mode : null;
  const canonicalEventName =
    typeof record.canonicalEventName === "string"
      ? record.canonicalEventName
      : null;
  if (
    mode !== "subscription_activation" &&
    canonicalEventName !== "subscription.minted"
  ) {
    return null;
  }

  const tokenId =
    typeof record.tokenId === "string" || typeof record.tokenId === "number"
      ? String(record.tokenId)
      : null;
  const onChainPlanId =
    typeof record.onChainPlanId === "string" ||
    typeof record.onChainPlanId === "number"
      ? String(record.onChainPlanId)
      : null;
  return tokenId && onChainPlanId
    ? `activation:${tokenId}:${onChainPlanId}`
    : null;
}

function resolveComponentEntitlementFeatureType(
  flagFeatureType: string | null | undefined,
  metadataEntitlement: ComponentPlanMetadataEntitlement,
): "boolean" | "event_based" | "trait_based" {
  if (metadataEntitlement.featureType === "trait") {
    return "trait_based";
  }
  if (
    metadataEntitlement.featureType === "event" ||
    metadataEntitlement.type === "NUMERIC" ||
    metadataEntitlement.type === "UNLIMITED" ||
    flagFeatureType === "event_based"
  ) {
    return "event_based";
  }
  if (flagFeatureType === "trait_based") {
    return "trait_based";
  }
  return "boolean";
}

// Handle CORS preflight requests from embedded apps
export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

export async function GET(c: Context) {
  const id = c.req.param("id");
  const origin = c.req.header("origin");

  // Extract token from Authorization header or query param
  const token = extractEmbedAccessToken(
    { get: (name: string) => c.req.header(name) },
    { get: (name: string) => c.req.query(name) ?? null },
    { allowQueryParam: true },
  );

  if (!token) {
    return c.json({ error: "Access token required" }, 401, corsHeaders(origin));
  }

  if (!process.env.ACCESS_TOKEN_SECRET) {
    return c.json(
      { error: "Server configuration error" },
      500,
      corsHeaders(origin),
    );
  }

  const decoded = await resolveEmbedAccessToken(token);
  if (!decoded) {
    return c.json(
      { error: "Invalid or expired access token" },
      401,
      corsHeaders(origin),
    );
  }

  const { teamId, environmentId, companyId, userId, componentId, preview } =
    decoded;
  if (!teamId) {
    return c.json(
      { error: "Invalid access token context" },
      401,
      corsHeaders(origin),
    );
  }

  if (preview && componentId !== id) {
    return c.json(
      { error: "Preview token is not valid for this component" },
      403,
      corsHeaders(origin),
    );
  }

  // Load the component
  const component = await db.embedComponent.findFirst({
    where: {
      id,
      teamId,
      ...(environmentId ? { environmentId } : {}),
    },
  });

  if (!component) {
    return c.json({ error: "Component not found" }, 404, corsHeaders(origin));
  }

  if (
    environmentId &&
    component.environmentId &&
    component.environmentId !== environmentId
  ) {
    return c.json(
      { error: "Component does not belong to this workspace environment" },
      403,
      corsHeaders(origin),
    );
  }

  // Load company data
  let companyData: Record<string, unknown> | null = null;
  let activePlan: Record<string, unknown> | null = null;
  let usageData: Record<string, unknown>[] = [];
  let entitlements: Record<string, unknown>[] = [];
  let nextBillingAt: string | null = null;
  let paymentMethod: Record<string, unknown> | null = null;
  let recentInvoices: Record<string, unknown>[] = [];
  let subscriptionTransition: Record<string, unknown> | null = null;
  let latestChangeRequest: Record<string, unknown> | null = null;
  let billingPaymentAccount: string | null = null;
  let liveOnChainPlanId: string | null = null;
  let liveOnChainTokenId: string | null = null;
  let liveCurrentPeriodEnd: string | null = null;
  let activeBillingPeriod: "monthly" | "annual" | null = null;
  let companyEnvironmentId: string | null = null;
  const scopedEnvironmentId = component.environmentId ?? environmentId ?? null;

  if (companyId) {
    const [company, user] = await Promise.all([
      db.arcenCompany.findFirst({
        where: {
          id: companyId,
          teamId,
          ...(scopedEnvironmentId ? { environmentId: scopedEnvironmentId } : {}),
        },
        select: {
          id: true,
          name: true,
          environmentId: true,
          walletAddress: true,
          email: true,
          activePlanId: true,
          traits: true,
          subscriptionState: {
            select: {
              status: true,
              catalogPlanId: true,
              walletAddress: true,
              onChainTokenId: true,
              currentPeriodEnd: true,
              metadata: true,
              chainId: true,
              environmentId: true,
            },
          },
        },
      }),
      userId
        ? db.arcenUser.findFirst({
            where: {
              id: userId,
              teamId,
              ...(scopedEnvironmentId ? { environmentId: scopedEnvironmentId } : {}),
            },
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
      const companyTraits = asRecord(company.traits);
      const subscriberEmailRecord =
        company.subscriptionState?.walletAddress || company.walletAddress
          ? await findScopedSubscriberEmail({
              teamId,
              environmentId:
                company.subscriptionState?.environmentId ??
                company.environmentId ??
                null,
              walletAddress:
                company.subscriptionState?.walletAddress ??
                company.walletAddress,
            })
          : null;

      companyData = {
        id: company.id,
        name: company.name,
        walletAddress: company.walletAddress,
        email: company.email ?? subscriberEmailRecord?.email ?? null,
      };

      latestChangeRequest = await getLatestSubscriptionChangeRequest({
        teamId,
        companyId: company.id,
      });
      if (latestChangeRequest) {
        subscriptionTransition = latestChangeRequest;
      }

      const effectiveActivePlanId =
        company.subscriptionState?.status === "ACTIVE" ||
        company.subscriptionState?.status === "PAST_DUE"
          ? (company.subscriptionState.catalogPlanId ?? company.activePlanId)
          : company.activePlanId;
      companyEnvironmentId = company.subscriptionState?.environmentId ?? null;

      if (effectiveActivePlanId) {
        activePlan = (await db.catalogPlan.findUnique({
          where: { id: effectiveActivePlanId },
          select: {
            id: true,
            name: true,
            tier: true,
            price: true,
            annualPrice: true,
            billingInterval: true,
            description: true,
            acceptedToken: true,
            onChainPlanId: true,
            chainId: true,
            environmentId: true,
            metadata: true,
          },
        })) as Record<string, unknown> | null;
        const activePlanCreditGrants = listComponentPlanMetadataCreditGrants(
          activePlan?.metadata ?? null,
        );
        if (activePlan && activePlanCreditGrants.length > 0) {
          const creditTypes = await db.catalogCreditType.findMany({
            where: {
              teamId,
              id: { in: activePlanCreditGrants.map((grant) => grant.creditTypeId) },
            },
            select: {
              id: true,
              name: true,
              code: true,
              unitName: true,
            },
          });
          activePlan = {
            ...activePlan,
            metadata: hydratePlanMetadataWithCreditGrants(
              activePlan.metadata,
              new Map(creditTypes.map((creditType) => [creditType.id, creditType])),
            ),
          };
        }
      }

      activeBillingPeriod =
        normalizeBillingPeriod(
          asRecord(company.subscriptionState?.metadata).billingPeriod,
        ) ??
        normalizeBillingPeriod(companyTraits.billingPeriod) ??
        deriveBillingPeriodFromInterval(activePlan?.billingInterval);
      const configuredChainId =
        (typeof activePlan?.chainId === "number" ? activePlan.chainId : null) ??
        (company.subscriptionState?.chainId ?? DEFAULT_CHAIN_ID);

      const deferredBillingPeriodRepair = resolveDeferredBillingPeriodRepair({
        transition: latestChangeRequest,
        activeBillingPeriod,
        liveCurrentPeriodEnd,
      });
      if (deferredBillingPeriodRepair) {
        const now = new Date();
        const repairedTransitionMetadata = {
          ...asRecord(latestChangeRequest?.metadata),
          mode: "next_renewal_on_chain",
          targetPlanName:
            typeof latestChangeRequest?.targetPlanName === "string"
              ? latestChangeRequest.targetPlanName
              : typeof activePlan?.name === "string"
                ? activePlan.name
                : null,
          previousBillingPeriod:
            deferredBillingPeriodRepair.previousBillingPeriod,
          targetBillingPeriod: deferredBillingPeriodRepair.targetBillingPeriod,
          repairedAt: now.toISOString(),
          repairedFromMode:
            typeof latestChangeRequest?.mode === "string"
              ? latestChangeRequest.mode
              : null,
        };
        const repairedTraits = {
          ...companyTraits,
          billingPeriod: deferredBillingPeriodRepair.previousBillingPeriod,
        };
        const repairedStateMetadata = {
          ...asRecord(company.subscriptionState?.metadata),
          source: "component.render",
          mode: "next_renewal_on_chain",
          billingPeriod: deferredBillingPeriodRepair.previousBillingPeriod,
          previousBillingPeriod:
            deferredBillingPeriodRepair.previousBillingPeriod,
          pendingBillingPeriod: deferredBillingPeriodRepair.targetBillingPeriod,
          pendingCatalogPlanId:
            latestChangeRequest?.targetPlanId ??
            (typeof activePlan?.id === "string" ? activePlan.id : null),
          pendingOnChainPlanId:
            liveOnChainPlanId ??
            (typeof activePlan?.onChainPlanId === "string"
              ? activePlan.onChainPlanId
              : null),
          repairedAt: now.toISOString(),
        };
        const repairedWalletAddress =
          billingPaymentAccount ??
          company.subscriptionState?.walletAddress ??
          company.walletAddress ??
          null;

        if (latestChangeRequest?.id && repairedWalletAddress) {
          try {
            await db.$transaction(async (tx) => {
              await tx.subscriptionChangeRequest.update({
                where: { id: String(latestChangeRequest?.id) },
                data: {
                  changeType: "BILLING_PERIOD_CHANGE",
                  stage: "REQUESTED",
                  effectiveAt: new Date(deferredBillingPeriodRepair.effectiveAt),
                  appliedAt: null,
                  pendingVerification: false,
                  failureReason: null,
                  metadata: toPrismaJson(repairedTransitionMetadata),
                },
              });

              await tx.arcenCompany.update({
                where: { id: company.id },
                data: {
                  traits: toPrismaJson(repairedTraits),
                },
              });

              await upsertSubscriptionLedgerState(
                {
                  teamId,
                  companyId: company.id,
                  walletAddress: repairedWalletAddress,
                  chainId: configuredChainId,
                  status:
                    company.subscriptionState?.status === "PAST_DUE"
                      ? "PAST_DUE"
                      : "ACTIVE",
                  catalogPlanId:
                    company.subscriptionState?.catalogPlanId ??
                    (typeof activePlan?.id === "string" ? activePlan.id : null),
                  onChainPlanId:
                    liveOnChainPlanId ??
                    (typeof activePlan?.onChainPlanId === "string"
                      ? activePlan.onChainPlanId
                      : null),
                  onChainTokenId:
                    liveOnChainTokenId ??
                    company.subscriptionState?.onChainTokenId ??
                    null,
                  currentPeriodEnd: new Date(
                    deferredBillingPeriodRepair.effectiveAt,
                  ),
                  cancelAtPeriodEnd: false,
                  cancelledAt: null,
                  pastDueAt: null,
                  graceEndsAt: null,
                  lastEvent: "subscription.render_repaired_billing_period_change",
                  lastEventAt: now,
                  metadata: repairedStateMetadata,
                },
                tx,
              );
            });
          } catch (error) {
            console.error(
              "[component-render] Failed to persist billing-period repair:",
              error,
            );
          }
        }

        activeBillingPeriod = deferredBillingPeriodRepair.previousBillingPeriod;
        subscriptionTransition = {
          ...asRecord(latestChangeRequest),
          changeType: "billing_period_change",
          stage: "requested",
          mode: "next_renewal_on_chain",
          effectiveAt: deferredBillingPeriodRepair.effectiveAt,
          pendingVerification: false,
          pendingRecovery: false,
          previousBillingPeriod:
            deferredBillingPeriodRepair.previousBillingPeriod,
          targetBillingPeriod: deferredBillingPeriodRepair.targetBillingPeriod,
          metadata: repairedTransitionMetadata,
        };
      }

      const companyKeys = {
        internalId: company.id,
        wallet: company.walletAddress ?? undefined,
        email: company.email ?? undefined,
      };
      const userKeys = user ? { internalId: user.id } : undefined;

      const [flags, entitlementResults] = await Promise.all([
        db.catalogFeatureFlag.findMany({
          where: { teamId },
          select: {
            featureKey: true,
            name: true,
            featureType: true,
            unitSingular: true,
            unitPlural: true,
            icon: true,
          },
        }),
        resolveEntitlementResults({
          teamId,
          companyKeys,
          userKeys,
        }),
      ]);

      const flagMap = new Map(flags.map((flag) => [flag.featureKey, flag]));
      const entitlementMap = new Map(
        entitlementResults.entitlements.map((entitlement) => [
          entitlement.key,
          entitlement,
        ]),
      );
      const activePlanEntitlements = listComponentPlanMetadataEntitlements(
        activePlan?.metadata ?? null,
        activeBillingPeriod ?? "monthly",
      ).filter((entry) => entry.enabled !== false);
      const activePlanCreditGrantEntitlements = toCreditGrantEntitlements(
        listComponentPlanMetadataCreditGrants(activePlan?.metadata ?? null),
      );

      entitlements = activePlanEntitlements.map((entry) => {
        const resolvedEntitlement = entitlementMap.get(entry.featureKey);
        const flag = flagMap.get(entry.featureKey);
        const featureType = resolveComponentEntitlementFeatureType(
          flag?.featureType,
          entry,
        );

        let value: boolean | number | string;
        if (featureType === "event_based") {
          value =
            entry.type === "NUMERIC" && typeof entry.value === "number"
              ? Number(entry.value)
              : (resolvedEntitlement?.usage ?? 0);
        } else if (featureType === "trait_based") {
          value = resolvedEntitlement?.enabled ? "Included" : "Disabled";
        } else {
          value =
            resolvedEntitlement?.enabled ??
            (entry.enabled !== false && entry.value !== false);
        }

        return {
          featureKey: entry.featureKey,
          name: entry.featureName ?? flag?.name ?? entry.featureKey,
          value,
          featureType,
          limit:
            entry.type === "NUMERIC" && typeof entry.value === "number"
              ? Number(entry.value)
              : undefined,
          usage: resolvedEntitlement?.usage ?? 0,
          exceeded: resolvedEntitlement?.exceeded ?? false,
          unitSingular:
            entry.valueUnit ?? flag?.unitSingular ?? null,
          unitPlural:
            entry.valueUnit ??
            flag?.unitPlural ??
            flag?.unitSingular ??
            null,
          icon: entry.icon ?? flag?.icon ?? null,
        };
      });
      entitlements = [...entitlements, ...activePlanCreditGrantEntitlements];

      usageData = entitlements
        .filter((entitlement) => entitlement.featureType === "event_based")
        .map((entitlement) => ({
          featureKey: entitlement.featureKey,
          name: entitlement.name,
          used: entitlement.usage ?? 0,
          limit: entitlement.limit ?? undefined,
          unitSingular: entitlement.unitSingular ?? null,
          unitPlural: entitlement.unitPlural ?? null,
          icon: typeof entitlement.icon === "string" ? entitlement.icon : null,
        }));

      // Invoice lookup: scoped strictly to this company by companyId.
      // Falls back to wallet/email for legacy invoices without companyId.
      const now = new Date();

      const invoices = await db.invoice.findMany({
        where: {
          teamId,
          OR: [
            { companyId: company.id },
            ...(company.walletAddress
              ? [{ companyId: null, customerWallet: company.walletAddress.toLowerCase() }]
              : []),
            ...(company.email
              ? [{ companyId: null, customerEmail: company.email }]
              : []),
          ],
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
            metadata: true,
            payments: {
              where: { txHash: { not: null } },
              select: { txHash: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        });
      const dedupedInvoices: typeof invoices = [];
      const seenInvoiceKeys = new Set<string>();
      for (const invoice of invoices) {
        const txHash =
          invoice.payments[0]?.txHash?.toLowerCase() ??
          readInvoiceTxHash(invoice.metadata);
        const invoiceKey = txHash
          ? `tx:${txHash}`
          : (readSubscriptionActivationInvoiceKey(invoice.metadata) ??
            `invoice:${invoice.id}`);
        if (seenInvoiceKeys.has(invoiceKey)) continue;
        seenInvoiceKeys.add(invoiceKey);
        dedupedInvoices.push(invoice);
      }

      recentInvoices = await Promise.all(
        dedupedInvoices.map(async (invoice) => {
          let downloadUrl: string | null = null;
          try {
            const preparedInvoice = await ensureInvoicePdfForTeam(
              teamId,
              invoice.id,
            );
            downloadUrl = preparedInvoice.downloadUrl;
          } catch {
            downloadUrl = null;
          }

          return {
            id: invoice.id,
            number: invoice.number,
            total: String(invoice.total),
            currency: invoice.currency,
            status: invoice.status,
            issuedAt: invoice.issuedAt?.toISOString() ?? null,
            dueAt: invoice.dueAt?.toISOString() ?? null,
            paidAt: invoice.paidAt?.toISOString() ?? null,
            customerName: readInvoiceCustomerName(invoice.metadata),
            customerEmail: invoice.customerEmail,
            customerWallet: invoice.customerWallet,
            downloadUrl,
          };
        }),
      );

      billingPaymentAccount = company.subscriptionState?.walletAddress ?? null;

      if (company.subscriptionState?.currentPeriodEnd) {
        nextBillingAt =
          company.subscriptionState.currentPeriodEnd.toISOString();
      }

      if (
        billingPaymentAccount ||
        company.subscriptionState?.onChainTokenId
      ) {
        try {
          const client = createPublicClient({
            transport: http(getRpcUrl(configuredChainId)),
          });
          const contracts = getContractAddresses(configuredChainId);
          let tokenId = 0n;
          let hasActiveSubscription = false;

          if (billingPaymentAccount) {
            tokenId = (await client.readContract({
              address: contracts.subscriptionRegistry as `0x${string}`,
              abi: SubscriptionRegistryABI,
              functionName: "getWalletSubscription",
              args: [billingPaymentAccount.toLowerCase() as `0x${string}`],
            })) as bigint;
            hasActiveSubscription = (await client.readContract({
              address: contracts.subscriptionRegistry as `0x${string}`,
              abi: SubscriptionRegistryABI,
              functionName: "hasActiveSubscription",
              args: [billingPaymentAccount.toLowerCase() as `0x${string}`],
            })) as boolean;
          }

          if (
            (!hasActiveSubscription || tokenId <= 0n) &&
            company.subscriptionState?.onChainTokenId
          ) {
            tokenId = BigInt(company.subscriptionState.onChainTokenId);
          }

          if (tokenId > 0n) {
            const owner = (await client.readContract({
              address: contracts.subscriptionRegistry as `0x${string}`,
              abi: [
                {
                  type: "function",
                  name: "ownerOf",
                  inputs: [{ name: "tokenId", type: "uint256" }],
                  outputs: [{ name: "", type: "address" }],
                  stateMutability: "view",
                },
              ] as const,
              functionName: "ownerOf",
              args: [tokenId],
            })) as `0x${string}`;
            const normalizedOwner = owner.toLowerCase();
            if (
              normalizedOwner &&
              normalizedOwner !== billingPaymentAccount?.toLowerCase()
            ) {
              billingPaymentAccount = normalizedOwner;
              await upsertSubscriptionLedgerState({
                teamId,
                companyId: company.id,
                walletAddress: normalizedOwner,
                chainId: configuredChainId,
                status:
                  company.subscriptionState?.status === "PAST_DUE"
                    ? "PAST_DUE"
                    : "ACTIVE",
                catalogPlanId:
                  company.subscriptionState?.catalogPlanId ??
                  (typeof activePlan?.id === "string" ? activePlan.id : null),
                onChainPlanId:
                  typeof activePlan?.onChainPlanId === "string"
                    ? activePlan.onChainPlanId
                    : null,
                onChainTokenId: tokenId.toString(),
                currentPeriodEnd: company.subscriptionState?.currentPeriodEnd ??
                  undefined,
                lastEvent: "subscription.render_owner_reconciled",
                lastEventAt: new Date(),
                metadata: {
                  source: "component_render",
                  previousWalletAddress:
                    company.subscriptionState?.walletAddress ?? null,
                },
              });
            }

            hasActiveSubscription = normalizedOwner === billingPaymentAccount;
          }

          if (hasActiveSubscription && tokenId > 0n) {
            const [expiration, planFeatures] = await Promise.all([
              client.readContract({
                address: contracts.subscriptionRegistry as `0x${string}`,
                abi: SubscriptionRegistryABI,
                functionName: "expiresAt",
                args: [tokenId],
              }) as Promise<bigint>,
              client.readContract({
                address: contracts.subscriptionRegistry as `0x${string}`,
                abi: SubscriptionRegistryABI,
                functionName: "getPlanFeatures",
                args: [tokenId],
              }) as Promise<[bigint, string]>,
            ]);
            liveOnChainTokenId = tokenId.toString();
            liveOnChainPlanId = planFeatures[0].toString();
            if (expiration > 0n) {
              liveCurrentPeriodEnd = new Date(
                Number(expiration) * 1000,
              ).toISOString();
              if (!nextBillingAt) {
                nextBillingAt = liveCurrentPeriodEnd;
              }
            }
          }
        } catch {
          if (!company.subscriptionState?.currentPeriodEnd) {
            nextBillingAt = null;
          }
        }
      }

      paymentMethod = {
        walletAddress: billingPaymentAccount,
        token:
          typeof activePlan?.acceptedToken === "string"
            ? activePlan.acceptedToken
            : "USDC",
        chainId: configuredChainId,
      };
    }
  }

  let effectiveEnvironmentId =
    companyEnvironmentId ??
    (typeof activePlan?.environmentId === "string"
      ? (activePlan.environmentId as string)
      : null);

  const fallbackCatalogConfig = !effectiveEnvironmentId
    ? await db.catalogConfig.findFirst({
        where: {
          teamId,
          environmentId: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          environmentId: true,
          livePlanIds: true,
          restrictLivePlans: true,
          initialPlan: true,
          fallbackPlan: true,
        },
      })
    : null;

  if (!effectiveEnvironmentId) {
    effectiveEnvironmentId = fallbackCatalogConfig?.environmentId ?? null;
  }

  const catalogConfig = effectiveEnvironmentId
    ? await db.catalogConfig.findUnique({
        where: { environmentId: effectiveEnvironmentId },
        select: {
          livePlanIds: true,
          restrictLivePlans: true,
          initialPlan: true,
          fallbackPlan: true,
        },
      })
    : fallbackCatalogConfig;
  const visiblePlanIds = deriveVisiblePlanIds(catalogConfig);

  // Load all published plans for the plans table element
  const allPlans = await db.catalogPlan.findMany({
    where: {
      teamId,
      status: "PUBLISHED",
      active: true,
      ...(effectiveEnvironmentId ? { environmentId: effectiveEnvironmentId } : {}),
      ...(visiblePlanIds ? { id: { in: visiblePlanIds } } : {})
    },
    orderBy: { price: "asc" },
    select: {
      id: true,
      name: true,
      tier: true,
      price: true,
      annualPrice: true,
      billingInterval: true,
      description: true,
      metadata: true,
      acceptedToken: true,
      onChainPlanId: true,
      chainId: true,
      chainTxHash: true,
      chainSyncStatus: true,
    },
  });

  let hydratedPlans = allPlans;
  const recoverablePlans = allPlans.filter(
    (plan) =>
      !plan.onChainPlanId &&
      typeof plan.chainTxHash === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(plan.chainTxHash),
  );

  if (recoverablePlans.length > 0) {
    try {
      // Group recoverable plans by their chain so we query each chain's RPC once.
      const plansByChain = new Map<number, typeof recoverablePlans>();
      for (const plan of recoverablePlans) {
        const cid = plan.chainId ?? DEFAULT_CHAIN_ID;
        if (!plansByChain.has(cid)) plansByChain.set(cid, []);
        plansByChain.get(cid)!.push(plan);
      }

      const recoveredIds = new Map<string, string>();

      for (const [chainId, chainPlans] of plansByChain) {
        const contracts = getContractAddresses(chainId);
        const planFactoryAddress = contracts.planFactory as `0x${string}`;
        if (
          !planFactoryAddress ||
          planFactoryAddress === "0x0000000000000000000000000000000000000000"
        ) continue;

        const rpcClient = createPublicClient({
          transport: http(getRpcUrl(chainId)),
        });

        for (const plan of chainPlans) {
          try {
            const receipt = await rpcClient.getTransactionReceipt({
              hash: plan.chainTxHash as `0x${string}`,
            });
            const logs = parseEventLogs({
              abi: PlanFactoryABI,
              logs: receipt.logs,
              eventName: "PlanCreated",
              strict: false,
            });

            const latestPlanCreatedLog = [...logs]
              .reverse()
              .find(
                (log) =>
                  typeof (log as { args?: { planId?: bigint } }).args
                    ?.planId === "bigint",
              );

            const planId = (
              latestPlanCreatedLog as { args?: { planId?: bigint } } | undefined
            )?.args?.planId;

            if (typeof planId !== "bigint") continue;

            const onChainPlanId = planId.toString();
            recoveredIds.set(plan.id, onChainPlanId);

            await db.catalogPlan.updateMany({
              where: { id: plan.id, onChainPlanId: null },
              data: {
                onChainPlanId,
                chainSyncStatus: "SYNCED",
                chainSyncError: null,
                chainSyncedAt: new Date(),
              },
            });
          } catch {
            // Best effort repair path only; ignore per-plan failures.
          }
        }
      }

      if (recoveredIds.size > 0) {
        hydratedPlans = allPlans.map((plan) => ({
          ...plan,
          onChainPlanId: recoveredIds.get(plan.id) ?? plan.onChainPlanId,
        }));
      }
    } catch {
      // Ignore auto-recovery errors and continue with current catalog state.
    }
  }

  const planCreditTypeIds = Array.from(
    new Set(
      hydratedPlans.flatMap((plan) =>
        listComponentPlanMetadataCreditGrants(plan.metadata).map(
          (grant) => grant.creditTypeId,
        ),
      ),
    ),
  );
  if (planCreditTypeIds.length > 0) {
    const creditTypes = await db.catalogCreditType.findMany({
      where: {
        teamId,
        id: { in: planCreditTypeIds },
      },
      select: {
        id: true,
        name: true,
        code: true,
        unitName: true,
      },
    });
    const creditTypeById = new Map(
      creditTypes.map((creditType) => [creditType.id, creditType]),
    );
    hydratedPlans = hydratedPlans.map((plan) => ({
      ...plan,
      metadata: hydratePlanMetadataWithCreditGrants(
        plan.metadata,
        creditTypeById,
      ) as typeof plan.metadata,
    }));
  }

  const liveMatchedPlan = liveOnChainPlanId
    ? (hydratedPlans.find((plan) => plan.onChainPlanId === liveOnChainPlanId) ??
      null)
    : null;
  const hasPendingNextRenewalPlanChange =
    typeof subscriptionTransition?.mode === "string" &&
    subscriptionTransition.mode === "next_renewal_on_chain" &&
    typeof subscriptionTransition?.targetPlanId === "string";

  if (
    liveMatchedPlan &&
    !hasPendingNextRenewalPlanChange &&
    (!activePlan ||
      String(
        (activePlan as { onChainPlanId?: unknown }).onChainPlanId ?? "",
      ) !== liveOnChainPlanId)
  ) {
    activePlan = {
      id: liveMatchedPlan.id,
      name: liveMatchedPlan.name,
      tier: liveMatchedPlan.tier,
      price: liveMatchedPlan.price,
      annualPrice: liveMatchedPlan.annualPrice,
      billingInterval: liveMatchedPlan.billingInterval,
      description: liveMatchedPlan.description,
      acceptedToken: liveMatchedPlan.acceptedToken,
      onChainPlanId: liveMatchedPlan.onChainPlanId,
      metadata: liveMatchedPlan.metadata,
    };

    if (companyId && billingPaymentAccount) {
      try {
        await upsertSubscriptionLedgerState({
          teamId,
          companyId,
          walletAddress: billingPaymentAccount,
          chainId: liveMatchedPlan.chainId ?? null,
          status: "ACTIVE",
          catalogPlanId: liveMatchedPlan.id,
          onChainPlanId: liveOnChainPlanId,
          onChainTokenId: liveOnChainTokenId,
          currentPeriodEnd: liveCurrentPeriodEnd
            ? new Date(liveCurrentPeriodEnd)
            : undefined,
          cancelAtPeriodEnd: false,
          cancelledAt: null,
          pastDueAt: null,
          graceEndsAt: null,
          lastEvent: "subscription.render_reconciled",
          lastEventAt: new Date(),
          metadata: {
            source: "component.render",
            reconciliation: "live_onchain_subscription",
          },
        });
      } catch (error) {
        console.error(
          "[component-render] Failed to persist live subscription reconciliation:",
          error,
        );
      }
    }
  }

  activeBillingPeriod =
    activeBillingPeriod ??
    deriveBillingPeriodFromInterval(activePlan?.billingInterval);

  const plansForResponse = hydratedPlans
    .filter((plan) => {
      const hasEntitlements =
        listAllMetadataEntitlements(plan.metadata).length > 0;
      const hasCreditGrants =
        listComponentPlanMetadataCreditGrants(plan.metadata).length > 0;
      const isPaid = parseFloat(String(plan.price ?? "0")) > 0;
      // Free plans always show. Paid plans must have customer-facing value configured.
      return !isPaid || hasEntitlements || hasCreditGrants;
    })
    .map((plan) => ({
    id: plan.id,
    name: plan.name,
    tier: plan.tier,
    price: plan.price,
    annualPrice: plan.annualPrice,
    billingInterval: plan.billingInterval,
    description: plan.description,
    metadata: plan.metadata,
    acceptedToken: plan.acceptedToken,
    onChainPlanId: plan.onChainPlanId,
  }));

  // Get provider's wallet (team owner) for payment routing
  const teamOwnerMember = await db.teamMember.findFirst({
    where: { teamId: teamId ?? "", role: "OWNER" },
    select: { user: { select: { walletAddress: true } } },
  });
  const providerWallet = teamOwnerMember?.user?.walletAddress ?? null;

  const rawElements = Array.isArray(component.elements)
    ? (component.elements as Array<Record<string, unknown>>)
    : [];
  const rawDesign = (component.design ?? {}) as Record<string, unknown>;

  return c.json(
    {
      data: {
        component: {
          id: component.id,
          name: component.name,
          elements: rawElements.map((el) => ({
            ...el,
            type: normalizeElementType(String(el.type ?? "")),
          })),
          design: normalizeComponentDesign(rawDesign),
        },
        company: companyData,
        activePlan,
        plans: plansForResponse,
        entitlements,
        usage: usageData,
        userId,
        providerWallet,
        nextBillingAt,
        billingPeriod: activeBillingPeriod,
        paymentMethod,
        recentInvoices,
        subscriptionTransition,
      },
    },
    200,
    corsHeaders(origin),
  );
}
