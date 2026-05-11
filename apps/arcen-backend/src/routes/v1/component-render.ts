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
import { db } from "../../db.js";
import { resolveEntitlementResults } from "../../lib/entitlements/entitlements.js";
import { getRpcUrl } from "../../config.js";
import { DEFAULT_CHAIN_ID } from "../../lib/platform/default-chain.js";
import { normalizeComponentDesign } from "../../lib/catalog/component-design.js";
import {
  extractEmbedAccessToken,
  resolveEmbedAccessToken,
} from "../../lib/entitlements/embed-access-token.js";
import { ensureInvoicePdfForTeam } from "../../lib/billing/invoice-documents.js";
import { upsertSubscriptionLedgerState } from "../../lib/billing/billing-ledger.js";
import { corsHeaders } from "../../middleware/cors.js";

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

  const { teamId, companyId, userId, componentId, preview } = decoded;
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
    where: { id, teamId },
  });

  if (!component) {
    return c.json({ error: "Component not found" }, 404, corsHeaders(origin));
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
  let billingPaymentAccount: string | null = null;
  let liveOnChainPlanId: string | null = null;
  let liveOnChainTokenId: string | null = null;
  let liveCurrentPeriodEnd: string | null = null;
  let activeBillingPeriod: "monthly" | "annual" | null = null;

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
          traits: true,
          subscriptionState: {
            select: {
              status: true,
              catalogPlanId: true,
              walletAddress: true,
              currentPeriodEnd: true,
              metadata: true,
            },
          },
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
      const subscriberEmailRecord =
        company.subscriptionState?.walletAddress || company.walletAddress
          ? await db.subscriberEmail.findUnique({
              where: {
                walletAddress: (company.subscriptionState?.walletAddress ??
                  company.walletAddress)!.toLowerCase(),
              },
              select: { email: true },
            })
          : null;

      companyData = {
        id: company.id,
        name: company.name,
        walletAddress: company.walletAddress,
        email: company.email ?? subscriberEmailRecord?.email ?? null,
      };

      const traits = asRecord(company.traits);
      const transition = asRecord(traits.subscriptionTransition);
      if (Object.keys(transition).length > 0) {
        subscriptionTransition = transition;
      }

      const effectiveActivePlanId =
        company.subscriptionState?.status === "ACTIVE" ||
        company.subscriptionState?.status === "PAST_DUE"
          ? (company.subscriptionState.catalogPlanId ?? company.activePlanId)
          : company.activePlanId;

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
            metadata: true,
          },
        })) as Record<string, unknown> | null;
      }

      activeBillingPeriod =
        normalizeBillingPeriod(
          asRecord(company.subscriptionState?.metadata).billingPeriod,
        ) ??
        normalizeBillingPeriod(traits.billingPeriod) ??
        deriveBillingPeriodFromInterval(activePlan?.billingInterval);

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
              ? (entitlement.allocation ?? entitlement.usage)
              : entitlement.enabled,
          featureType,
          limit: entitlement.allocation ?? undefined,
          usage: entitlement.usage,
          exceeded: entitlement.exceeded,
          unitSingular: flag?.unitSingular ?? null,
          unitPlural: flag?.unitPlural ?? flag?.unitSingular ?? null,
          icon: flag?.icon ?? null,
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
          icon: typeof entitlement.icon === "string" ? entitlement.icon : null,
        }));

      const invoiceFilters = [
        company.walletAddress
          ? { customerWallet: company.walletAddress.toLowerCase() }
          : null,
        company.subscriptionState?.walletAddress
          ? {
              customerWallet:
                company.subscriptionState.walletAddress.toLowerCase(),
            }
          : null,
        company.email ? { customerEmail: company.email } : null,
        subscriberEmailRecord?.email
          ? { customerEmail: subscriberEmailRecord.email }
          : null,
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

        recentInvoices = await Promise.all(
          invoices.map(async (invoice) => {
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
              customerEmail: invoice.customerEmail,
              customerWallet: invoice.customerWallet,
              downloadUrl,
            };
          }),
        );
      }

      const configuredChainId = DEFAULT_CHAIN_ID;
      billingPaymentAccount = company.subscriptionState?.walletAddress ?? null;

      paymentMethod = {
        walletAddress: billingPaymentAccount,
        token:
          typeof activePlan?.acceptedToken === "string"
            ? activePlan.acceptedToken
            : "USDC",
        chainId: configuredChainId,
      };

      if (company.subscriptionState?.currentPeriodEnd) {
        nextBillingAt =
          company.subscriptionState.currentPeriodEnd.toISOString();
      }

      if (billingPaymentAccount) {
        try {
          const client = createPublicClient({
            transport: http(getRpcUrl(configuredChainId)),
          });
          const contracts = getContractAddresses(configuredChainId);
          const tokenId = (await client.readContract({
            address: contracts.subscriptionRegistry as `0x${string}`,
            abi: SubscriptionRegistryABI,
            functionName: "getWalletSubscription",
            args: [billingPaymentAccount.toLowerCase() as `0x${string}`],
          })) as bigint;
          const hasActiveSubscription = (await client.readContract({
            address: contracts.subscriptionRegistry as `0x${string}`,
            abi: SubscriptionRegistryABI,
            functionName: "hasActiveSubscription",
            args: [billingPaymentAccount.toLowerCase() as `0x${string}`],
          })) as boolean;

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
    }
  }

  // Load all published plans for the plans table element
  const allPlans = await db.catalogPlan.findMany({
    where: { teamId, status: "PUBLISHED", active: true },
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
      const configuredChainId = DEFAULT_CHAIN_ID;
      const contracts = getContractAddresses(configuredChainId);
      const planFactoryAddress = contracts.planFactory as `0x${string}`;

      if (
        planFactoryAddress &&
        planFactoryAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        const rpcClient = createPublicClient({
          transport: http(getRpcUrl(configuredChainId)),
        });

        const recoveredIds = new Map<string, string>();

        for (const plan of recoverablePlans) {
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

        if (recoveredIds.size > 0) {
          hydratedPlans = allPlans.map((plan) => ({
            ...plan,
            onChainPlanId: recoveredIds.get(plan.id) ?? plan.onChainPlanId,
          }));
        }
      }
    } catch {
      // Ignore auto-recovery errors and continue with current catalog state.
    }
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
      await upsertSubscriptionLedgerState({
        teamId,
        companyId,
        walletAddress: billingPaymentAccount,
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
    }
  }

  activeBillingPeriod =
    activeBillingPeriod ??
    deriveBillingPeriodFromInterval(activePlan?.billingInterval);

  const plansForResponse = hydratedPlans.map((plan) => ({
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
