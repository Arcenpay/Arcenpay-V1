import {
  CHAIN_REGISTRY,
  getChain,
  getChainFamily,
  getContractAddresses,
} from "@arcenpay/internal-core";
import { db } from "../db.js";
import { APP_URL } from "../config.js";
import { mandateService } from "../services/mandate.service.js";
import { escrowService } from "../services/escrow.service.js";
import {
  getPaymentLinkBySlug,
  listPaymentLinks,
  toAgenticSpecification,
} from "../lib/payments/payment-links.js";
import { resolveEntitlementResult } from "../lib/entitlements/entitlements.js";
import { createInvoiceDownloadUrl } from "../lib/billing/invoice-documents.js";
import type { ApiKeyContext } from "../lib/auth/api-key-auth.js";

/**
 * Read-only data access for the hosted MCP server.
 *
 * Kept behind an interface so tool handlers can be unit-tested with fakes and
 * so the transport never reaches into Prisma directly. Every method is scoped
 * to the authenticated context's team — a teamId is never taken from the caller.
 */
export interface ListCompaniesOptions {
  limit?: number;
  cursor?: string;
  search?: string;
}

export interface ListInvoicesOptions {
  limit?: number;
  status?: "DRAFT" | "ISSUED" | "PAID" | "VOID" | "OVERDUE";
}

export type InvoiceDocumentKindArg = "invoice" | "receipt";

export interface McpDeps {
  listCompanies(ctx: ApiKeyContext, options: ListCompaniesOptions): Promise<unknown>;
  getCompany(ctx: ApiKeyContext, id: string): Promise<unknown | null>;
  listPaymentLinks(ctx: ApiKeyContext): Promise<unknown>;
  getPaymentLinkSpec(ctx: ApiKeyContext, slug: string): Promise<unknown | null>;
  listPlans(ctx: ApiKeyContext): Promise<unknown>;
  listAddons(ctx: ApiKeyContext): Promise<unknown>;
  getSubscription(ctx: ApiKeyContext, companyId: string): Promise<unknown | null>;
  checkEntitlement(
    ctx: ApiKeyContext,
    companyId: string,
    featureKey: string,
  ): Promise<unknown | null>;
  listInvoices(ctx: ApiKeyContext, options: ListInvoicesOptions): Promise<unknown>;
  getInvoice(ctx: ApiKeyContext, id: string): Promise<unknown | null>;
  getInvoiceDownloadUrl(
    ctx: ApiKeyContext,
    id: string,
    kind: InvoiceDocumentKindArg,
  ): Promise<string | null>;
  listChains(): Promise<unknown>;
  getMandateStatus(mandateId: string): unknown;
  getSettlementStatus(requestNonce: string): unknown;
}

const COMPANY_SELECT = {
  id: true,
  name: true,
  walletAddress: true,
  email: true,
  externalId: true,
  activePlanId: true,
  logoUrl: true,
  createdAt: true,
  lastSeenAt: true,
} as const;

const INVOICE_SELECT = {
  id: true,
  number: true,
  status: true,
  currency: true,
  total: true,
  amountPaid: true,
  amountOutstanding: true,
  customerEmail: true,
  companyId: true,
  issuedAt: true,
  paidAt: true,
  dueAt: true,
  createdAt: true,
} as const;

/** Decimal columns serialize as strings so JSON output is lossless. */
function serializeInvoice<
  T extends {
    total: unknown;
    amountPaid: unknown;
    amountOutstanding: unknown;
  },
>(invoice: T) {
  return {
    ...invoice,
    total: String(invoice.total),
    amountPaid: String(invoice.amountPaid),
    amountOutstanding: String(invoice.amountOutstanding),
  };
}

export function createDefaultMcpDeps(): McpDeps {
  return {
    async listCompanies(ctx, { limit = 50, cursor, search } = {}) {
      const environmentId = ctx.environmentId;
      if (!environmentId) {
        throw new Error("No workspace environment selected for this API key");
      }

      const take = Math.min(limit, 200);
      const companies = await db.arcenCompany.findMany({
        where: {
          teamId: ctx.teamId,
          environmentId,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { email: { contains: search, mode: "insensitive" as const } },
                  { walletAddress: { contains: search, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
        orderBy: { lastSeenAt: "desc" },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: COMPANY_SELECT,
      });

      const hasMore = companies.length > take;
      const items = hasMore ? companies.slice(0, take) : companies;
      return {
        items,
        count: items.length,
        nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
      };
    },

    async getCompany(ctx, id) {
      return db.arcenCompany.findFirst({
        where: { teamId: ctx.teamId, id },
        select: COMPANY_SELECT,
      });
    },

    async listPaymentLinks(ctx) {
      const links = await listPaymentLinks(ctx.teamId, ctx.environmentId);
      return links.map((link) => ({
        id: link.id,
        slug: link.slug,
        name: link.name,
        amount: link.amount,
        currency: link.currency,
        status: link.status,
        chainId: link.chainId,
        chainFamily: link.chainFamily,
        isAgentic: Boolean(
          (link.metadata as Record<string, unknown> | null)?.isAgentic,
        ),
      }));
    },

    async getPaymentLinkSpec(ctx, slug) {
      const link = await getPaymentLinkBySlug(slug);
      // Never expose another team's link via the shared public slug space.
      if (!link || link.teamId !== ctx.teamId) return null;
      return toAgenticSpecification(link, APP_URL);
    },

    async listPlans(ctx) {
      // Published + active only — never leak draft/archived pricing.
      const plans = await db.catalogPlan.findMany({
        where: {
          teamId: ctx.teamId,
          status: "PUBLISHED",
          active: true,
          ...(ctx.environmentId ? { environmentId: ctx.environmentId } : {}),
        },
        orderBy: [{ tier: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          tier: true,
          description: true,
          price: true,
          annualPrice: true,
          billingInterval: true,
          acceptedToken: true,
          chainId: true,
          chainFamily: true,
          onChainPlanId: true,
        },
      });
      return plans.map((plan) => ({
        ...plan,
        price: plan.price.toString(),
        annualPrice: plan.annualPrice ? plan.annualPrice.toString() : null,
      }));
    },

    async listAddons(ctx) {
      const addons = await db.catalogAddOn.findMany({
        where: {
          teamId: ctx.teamId,
          status: "PUBLISHED",
          active: true,
          ...(ctx.environmentId ? { environmentId: ctx.environmentId } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          billingType: true,
          saleMode: true,
          price: true,
          billingIntervalDays: true,
          acceptedToken: true,
        },
      });
      return addons.map((addon) => ({
        ...addon,
        price: addon.price.toString(),
      }));
    },

    async getSubscription(ctx, companyId) {
      const company = await db.arcenCompany.findFirst({
        where: { teamId: ctx.teamId, id: companyId },
        select: { id: true },
      });
      if (!company) return null;

      const state = await db.subscriptionState.findUnique({
        where: { companyId },
        select: {
          companyId: true,
          status: true,
          catalogPlanId: true,
          onChainPlanId: true,
          onChainTokenId: true,
          chainId: true,
          chainFamily: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          cancelledAt: true,
          pastDueAt: true,
          graceEndsAt: true,
          lastEvent: true,
          lastEventAt: true,
        },
      });

      return { companyId, subscription: state ?? null };
    },

    async checkEntitlement(ctx, companyId, featureKey) {
      const company = await db.arcenCompany.findFirst({
        where: { teamId: ctx.teamId, id: companyId },
        select: { id: true },
      });
      if (!company) return null;

      return resolveEntitlementResult({
        teamId: ctx.teamId,
        companyKeys: { internalId: companyId, environmentId: ctx.environmentId },
        featureKey,
      });
    },

    async listInvoices(ctx, { limit = 25, status } = {}) {
      const invoices = await db.invoice.findMany({
        where: {
          teamId: ctx.teamId,
          ...(ctx.environmentId ? { environmentId: ctx.environmentId } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: Math.min(limit, 100),
        select: INVOICE_SELECT,
      });
      return invoices.map((invoice) => serializeInvoice(invoice));
    },

    async getInvoice(ctx, id) {
      const invoice = await db.invoice.findFirst({
        where: { teamId: ctx.teamId, id },
        select: INVOICE_SELECT,
      });
      return invoice ? serializeInvoice(invoice) : null;
    },

    async getInvoiceDownloadUrl(ctx, id, kind) {
      const invoice = await db.invoice.findFirst({
        where: { teamId: ctx.teamId, id },
        select: { id: true },
      });
      if (!invoice) return null;
      return createInvoiceDownloadUrl({ invoiceId: id, kind });
    },

    async listChains() {
      return Object.keys(CHAIN_REGISTRY).map((key) => {
        const chainId = Number(key);
        const chain = getChain(chainId);
        let contracts: Record<string, string> | null = null;
        try {
          contracts = getContractAddresses(chainId) as unknown as Record<
            string,
            string
          >;
        } catch {
          contracts = null;
        }
        return {
          chainId,
          name: chain.name,
          testnet: Boolean(chain.testnet),
          family: getChainFamily(chainId),
          contracts,
        };
      });
    },

    getMandateStatus(mandateId) {
      return mandateService.getMandateStatus(mandateId);
    },

    getSettlementStatus(requestNonce) {
      return escrowService.getStatus(requestNonce);
    },
  };
}
