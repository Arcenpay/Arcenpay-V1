import { randomUUID } from "node:crypto";
import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { DEFAULT_CHAIN_ID } from "../platform/default-chain.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeWallet(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

export async function createPaymentLink(input: {
  teamId: string;
  environmentId?: string | null;
  kind: "ADDON" | "INVOICE" | "CUSTOM";
  name: string;
  description?: string | null;
  companyId?: string | null;
  catalogAddOnId?: string | null;
  invoiceId?: string | null;
  currency?: string;
  amount: number;
  acceptedToken: string;
  chainId?: number;
  recipientWallet: string;
  successUrl?: string | null;
  cancelUrl?: string | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}) {
  const baseSlug = slugify(input.name) || "payment";
  const slug = `${baseSlug}-${randomUUID().slice(0, 8)}`;

  return db.paymentLink.create({
    data: {
      teamId: input.teamId,
      environmentId: input.environmentId ?? null,
      kind: input.kind,
      name: input.name.trim(),
      slug,
      description: input.description?.trim() || null,
      companyId: input.companyId ?? null,
      catalogAddOnId: input.catalogAddOnId ?? null,
      invoiceId: input.invoiceId ?? null,
      currency: input.currency ?? "USDC",
      amount: input.amount.toFixed(6),
      acceptedToken: normalizeWallet(input.acceptedToken) || input.acceptedToken,
      chainId: input.chainId ?? DEFAULT_CHAIN_ID,
      recipientWallet:
        normalizeWallet(input.recipientWallet) || input.recipientWallet,
      successUrl: input.successUrl ?? null,
      cancelUrl: input.cancelUrl ?? null,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ? toPrismaJson(input.metadata) : undefined,
    },
    include: {
      catalogAddOn: true,
      invoice: true,
      company: {
        select: { id: true, name: true, email: true, walletAddress: true },
      },
    },
  });
}

export async function listPaymentLinks(teamId: string, environmentId?: string | null) {
  return db.paymentLink.findMany({
    where: { teamId, ...(environmentId ? { environmentId } : {}) },
    include: {
      catalogAddOn: {
        select: { id: true, name: true, code: true, billingType: true, saleMode: true },
      },
      invoice: {
        select: { id: true, number: true, status: true, total: true, currency: true },
      },
      company: {
        select: { id: true, name: true, email: true, walletAddress: true },
      },
      checkoutSessions: {
        select: { id: true, status: true, paidAt: true, txHash: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getPaymentLinkById(teamId: string, id: string) {
  return db.paymentLink.findFirst({
    where: { teamId, id },
    include: {
      catalogAddOn: true,
      invoice: true,
      company: true,
    },
  });
}

export async function getPaymentLinkBySlug(slug: string) {
  return db.paymentLink.findUnique({
    where: { slug },
    include: {
      catalogAddOn: true,
      invoice: true,
      company: true,
    },
  });
}

export async function updatePaymentLink(input: {
  teamId: string;
  id: string;
  status?: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  name?: string;
  description?: string | null;
  recipientWallet?: string;
  successUrl?: string | null;
  cancelUrl?: string | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}) {
  return db.paymentLink.updateMany({
    where: { teamId: input.teamId, id: input.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.recipientWallet
        ? {
            recipientWallet:
              normalizeWallet(input.recipientWallet) || input.recipientWallet,
          }
        : {}),
      ...(input.successUrl !== undefined ? { successUrl: input.successUrl } : {}),
      ...(input.cancelUrl !== undefined ? { cancelUrl: input.cancelUrl } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
    },
  });
}
