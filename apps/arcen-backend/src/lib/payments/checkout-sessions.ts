import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { DEFAULT_CHAIN_ID } from "../platform/default-chain.js";
import { resolveChainFamilyForPrisma } from "../platform/chain-family.js";
import {
  decimalToAtomicUnits,
  verifyDirectErc20Transfer,
} from "./onchain-payment-verification.js";
import { recordSuccessfulPayment } from "../billing/billing-ledger.js";
import { createIssuedChargeInvoice } from "../billing/billing-events.js";
import { grantCompanyAddOn } from "../companies/addon-grants.js";
import { grantCompanyCredits } from "../billing/usage-credits.js";
import { sendPaidInvoiceReceipt } from "../billing/invoice-notifications.js";
import { deliverWebhook } from "../webhooks/deliver-webhook.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readPositiveInteger(value: unknown): number | null {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(numberValue) && numberValue > 0
    ? numberValue
    : null;
}

function normalizeWallet(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

function deriveCheckoutDescription(input: {
  purpose: "ADDON" | "INVOICE" | "CUSTOM";
  paymentLinkName?: string | null;
  addOnName?: string | null;
  invoiceNumber?: string | null;
}): string {
  if (input.purpose === "ADDON") {
    return input.addOnName
      ? `One-time purchase: ${input.addOnName}`
      : input.paymentLinkName || "One-time add-on purchase";
  }
  if (input.purpose === "INVOICE") {
    return input.invoiceNumber
      ? `Invoice payment ${input.invoiceNumber}`
      : input.paymentLinkName || "Invoice payment";
  }
  return input.paymentLinkName || "One-time payment";
}

function readCreditPurchaseMetadata(
  ...metadataSources: unknown[]
): { creditTypeId: string; bundleId?: string | null; units?: number | null } | null {
  for (const source of metadataSources) {
    const metadata = asRecord(source);
    const purchase = asRecord(metadata.creditPurchase);
    const sourceRecord =
      Object.keys(purchase).length > 0 ? purchase : metadata;
    const creditTypeId =
      typeof sourceRecord.creditTypeId === "string" &&
      sourceRecord.creditTypeId.trim()
        ? sourceRecord.creditTypeId.trim()
        : null;
    if (!creditTypeId) continue;

    return {
      creditTypeId,
      bundleId:
        typeof sourceRecord.bundleId === "string" &&
        sourceRecord.bundleId.trim()
          ? sourceRecord.bundleId.trim()
          : typeof sourceRecord.creditBundleId === "string" &&
              sourceRecord.creditBundleId.trim()
            ? sourceRecord.creditBundleId.trim()
            : null,
      units:
        readPositiveInteger(sourceRecord.units) ??
        readPositiveInteger(sourceRecord.amount),
    };
  }
  return null;
}

async function resolveCreditPurchaseGrant(input: {
  teamId: string;
  environmentId?: string | null;
  sessionAmount: number;
  sessionMetadata?: unknown;
  paymentLinkMetadata?: unknown;
}) {
  const purchase = readCreditPurchaseMetadata(
    input.sessionMetadata,
    input.paymentLinkMetadata,
  );
  if (!purchase) return null;

  const creditType = await db.catalogCreditType.findFirst({
    where: {
      id: purchase.creditTypeId,
      teamId: input.teamId,
      active: true,
      status: { not: "ARCHIVED" },
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
    },
    select: { id: true, metadata: true },
  });
  if (!creditType) return null;

  if (purchase.bundleId) {
    const bundles = asRecord(creditType.metadata).bundles;
    const bundle = Array.isArray(bundles)
      ? bundles.map(asRecord).find((item) => item.id === purchase.bundleId)
      : null;
    const units = readPositiveInteger(bundle?.units);
    const price =
      typeof bundle?.price === "number"
        ? bundle.price
        : typeof bundle?.price === "string"
          ? Number(bundle.price)
          : Number.NaN;

    if (!units || !Number.isFinite(price) || input.sessionAmount + 0.000001 < price) {
      return null;
    }

    return {
      creditTypeId: creditType.id,
      units,
      bundleId: purchase.bundleId,
      bundleName:
        typeof bundle?.name === "string" && bundle.name.trim()
          ? bundle.name.trim()
          : null,
    };
  }

  if (!purchase.units) return null;
  return {
    creditTypeId: creditType.id,
    units: purchase.units,
    bundleId: null,
    bundleName: null,
  };
}

async function resolveOrCreateCompany(input: {
  teamId: string;
  environmentId?: string | null;
  companyId?: string | null;
  customerWallet?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
}) {
  if (input.companyId) {
    return db.arcenCompany.findFirst({
      where: {
        id: input.companyId,
        teamId: input.teamId,
        ...(input.environmentId ? { environmentId: input.environmentId } : {}),
      },
      select: { id: true, name: true },
    });
  }

  const walletAddress = normalizeWallet(input.customerWallet);
  const customerEmail = input.customerEmail?.trim() || null;
  if (!walletAddress && !customerEmail) return null;

  const existing = await db.arcenCompany.findFirst({
    where: {
      teamId: input.teamId,
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
      OR: [
        ...(walletAddress ? [{ walletAddress }] : []),
        ...(customerEmail
          ? [{ email: { equals: customerEmail, mode: "insensitive" as const } }]
          : []),
      ],
    },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  return db.arcenCompany.create({
    data: {
      teamId: input.teamId,
      environmentId: input.environmentId ?? null,
      name: input.customerName?.trim() || customerEmail || walletAddress || "Hosted checkout customer",
      walletAddress,
      email: customerEmail,
    },
    select: { id: true, name: true },
  });
}

export async function createCheckoutSession(input: {
  teamId: string;
  environmentId?: string | null;
  purpose: "ADDON" | "INVOICE" | "CUSTOM";
  paymentLinkId?: string | null;
  companyId?: string | null;
  catalogAddOnId?: string | null;
  invoiceId?: string | null;
  customerEmail?: string | null;
  customerWallet?: string | null;
  customerName?: string | null;
  amount: number;
  currency?: string;
  acceptedToken: string;
  chainId?: number;
  recipientWallet: string;
  successUrl?: string | null;
  cancelUrl?: string | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}) {
  const session = await db.checkoutSession.create({
    data: {
      teamId: input.teamId,
      environmentId: input.environmentId ?? null,
      purpose: input.purpose,
      paymentLinkId: input.paymentLinkId ?? null,
      companyId: input.companyId ?? null,
      catalogAddOnId: input.catalogAddOnId ?? null,
      invoiceId: input.invoiceId ?? null,
      customerEmail: input.customerEmail?.trim() || null,
      customerWallet: normalizeWallet(input.customerWallet),
      customerName: input.customerName?.trim() || null,
      amount: input.amount.toFixed(6),
      currency: input.currency ?? "USDC",
      acceptedToken: normalizeWallet(input.acceptedToken) || input.acceptedToken,
      chainId: input.chainId ?? DEFAULT_CHAIN_ID,
      chainFamily: resolveChainFamilyForPrisma(input.chainId ?? DEFAULT_CHAIN_ID),
      recipientWallet:
        normalizeWallet(input.recipientWallet) || input.recipientWallet,
      successUrl: input.successUrl ?? null,
      cancelUrl: input.cancelUrl ?? null,
      expiresAt:
        input.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
      metadata: input.metadata ? toPrismaJson(input.metadata) : undefined,
    },
    include: {
      paymentLink: true,
      catalogAddOn: true,
      invoice: true,
      company: true,
    },
  });

  deliverWebhook(input.teamId, "checkout.session.created", {
    environmentId: session.environmentId ?? input.environmentId ?? null,
    checkoutSessionId: session.id,
    paymentLinkId: session.paymentLinkId ?? null,
    paymentLinkSlug: session.paymentLink?.slug ?? null,
    purpose: session.purpose,
    status: session.status,
    amount: session.amount,
    currency: session.currency,
    acceptedToken: session.acceptedToken,
    chainId: session.chainId,
    recipientWallet: session.recipientWallet,
    customerEmail: session.customerEmail ?? null,
    customerWallet: session.customerWallet ?? null,
    customerName: session.customerName ?? null,
    companyId: session.companyId ?? null,
    catalogAddOnId: session.catalogAddOnId ?? null,
    invoiceId: session.invoiceId ?? null,
    successUrl: session.successUrl ?? null,
    cancelUrl: session.cancelUrl ?? null,
    expiresAt: session.expiresAt?.toISOString() ?? null,
  }).catch(() => {});

  return session;
}

export async function getCheckoutSessionById(id: string, teamId?: string) {
  return db.checkoutSession.findFirst({
    where: { id, ...(teamId ? { teamId } : {}) },
    include: {
      paymentLink: {
        include: {
          catalogAddOn: true,
          invoice: true,
          company: true,
        },
      },
      catalogAddOn: true,
      invoice: true,
      company: true,
      payment: true,
    },
  });
}

export async function updateCheckoutSessionCustomerDetails(input: {
  sessionId: string;
  customerEmail?: string | null;
  customerWallet?: string | null;
  customerName?: string | null;
}) {
  return db.checkoutSession.update({
    where: { id: input.sessionId },
    data: {
      customerEmail: input.customerEmail?.trim() || null,
      customerWallet: normalizeWallet(input.customerWallet),
      customerName: input.customerName?.trim() || null,
    },
    include: {
      paymentLink: {
        include: {
          catalogAddOn: true,
          invoice: true,
          company: true,
        },
      },
      catalogAddOn: true,
      invoice: true,
      company: true,
      payment: true,
    },
  });
}

export async function confirmCheckoutSessionPayment(input: {
  sessionId: string;
  txHash: `0x${string}`;
  senderWallet?: string | null;
}) {
  const session = await getCheckoutSessionById(input.sessionId);
  if (!session) {
    return { ok: false as const, status: 404, error: "Checkout session not found." };
  }
  if (session.status === "PAID") {
    return { ok: true as const, session };
  }
  if (session.status !== "PENDING") {
    return { ok: false as const, status: 409, error: `Checkout session is ${session.status.toLowerCase()}.` };
  }
  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    await db.checkoutSession.update({
      where: { id: session.id },
      data: { status: "EXPIRED" },
    });
    return { ok: false as const, status: 410, error: "Checkout session expired." };
  }

  const amountAtomic = decimalToAtomicUnits(String(session.amount), 6);
  const verification = await verifyDirectErc20Transfer({
    acceptedToken: session.acceptedToken,
    txHash: input.txHash,
    expectedAmountAtomic: amountAtomic,
    recipientWallet: session.recipientWallet,
    senderWallet: input.senderWallet ?? session.customerWallet ?? undefined,
  });

  if (!verification.ok) {
    await db.checkoutSession.update({
      where: { id: session.id },
      data: {
        verificationError: verification.error,
      },
    });
    return verification;
  }

  const company = await resolveOrCreateCompany({
    teamId: session.teamId,
    environmentId: session.environmentId,
    companyId: session.companyId,
    customerWallet: session.customerWallet ?? verification.senderWallet,
    customerEmail: session.customerEmail,
    customerName: session.customerName,
  });

  let invoiceId = session.invoiceId ?? session.paymentLink?.invoiceId ?? null;
  if (!invoiceId && (session.purpose === "ADDON" || session.purpose === "CUSTOM")) {
    const issued = await createIssuedChargeInvoice({
      teamId: session.teamId,
      environmentId: session.environmentId,
      amount: Number(session.amount),
      description: deriveCheckoutDescription({
        purpose: session.purpose,
        paymentLinkName: session.paymentLink?.name,
        addOnName: session.catalogAddOn?.name ?? session.paymentLink?.catalogAddOn?.name,
      }),
      customerEmail: session.customerEmail ?? null,
      customerName: session.customerName ?? company?.name ?? null,
      customerWallet: session.customerWallet ?? verification.senderWallet,
      metadata: {
        checkoutSessionId: session.id,
        paymentLinkId: session.paymentLinkId,
        catalogAddOnId: session.catalogAddOnId ?? session.paymentLink?.catalogAddOnId ?? null,
        purpose: session.purpose,
      },
    });
    invoiceId = issued.invoice.id;
  }

  const paymentKind =
    session.purpose === "INVOICE"
      ? "MANUAL_INVOICE_PAYMENT"
      : session.purpose === "ADDON"
        ? "ADDON_PURCHASE"
        : "CUSTOM_PAYMENT";

  const payment = await recordSuccessfulPayment({
    idempotencyKey: `checkout-session:${session.id}`,
    teamId: session.teamId,
    companyId: company?.id ?? null,
    walletAddress: session.customerWallet ?? verification.senderWallet,
    invoiceId,
    kind: paymentKind,
    amount: Number(session.amount),
    currency: session.currency,
    payerWallet: verification.senderWallet,
    recipientWallet: verification.recipientWallet,
    acceptedToken: session.acceptedToken,
    txHash: verification.txHash,
    occurredAt: new Date(),
    settledAt: new Date(),
    preserveScheduledCancellation: true,
    metadata: {
      checkoutSessionId: session.id,
      paymentLinkId: session.paymentLinkId,
      purpose: session.purpose,
    },
  });

  if ((session.catalogAddOnId || session.paymentLink?.catalogAddOnId) && company?.id) {
    await grantCompanyAddOn({
      teamId: session.teamId,
      companyId: company.id,
      catalogAddOnId:
        session.catalogAddOnId || session.paymentLink?.catalogAddOnId || "",
      source: session.paymentLinkId ? "PAYMENT_LINK" : "ADDON_PURCHASE",
      paymentId: payment.id,
      checkoutSessionId: session.id,
      metadata: {
        purpose: session.purpose,
        txHash: verification.txHash,
      },
    });
  }

  const creditPurchase = company?.id
    ? await resolveCreditPurchaseGrant({
        teamId: session.teamId,
        environmentId: session.environmentId,
        sessionAmount: Number(session.amount),
        sessionMetadata: session.metadata,
        paymentLinkMetadata: session.paymentLink?.metadata,
      })
    : null;

  if (creditPurchase && company?.id) {
    await grantCompanyCredits({
      teamId: session.teamId,
      environmentId: session.environmentId ?? null,
      companyId: company.id,
      creditTypeId: creditPurchase.creditTypeId,
      amount: creditPurchase.units,
      source: "CREDIT_BUNDLE",
      paymentId: payment.id,
      checkoutSessionId: session.id,
      idempotencyKey: [
        "credit-bundle",
        session.id,
        creditPurchase.creditTypeId,
        creditPurchase.bundleId ?? creditPurchase.units,
      ].join(":"),
      metadata: {
        purpose: session.purpose,
        txHash: verification.txHash,
        paymentLinkId: session.paymentLinkId,
        bundleId: creditPurchase.bundleId,
        bundleName: creditPurchase.bundleName,
      },
    });
  }

  const updated = await db.checkoutSession.update({
    where: { id: session.id },
    data: {
      companyId: company?.id ?? session.companyId ?? null,
      paymentId: payment.id,
      invoiceId,
      customerWallet: session.customerWallet ?? verification.senderWallet,
      status: "PAID",
      txHash: verification.txHash,
      verificationError: null,
      paidAt: new Date(),
    },
    include: {
      paymentLink: true,
      catalogAddOn: true,
      invoice: true,
      company: true,
      payment: true,
    },
  });

  if (invoiceId) {
    await sendPaidInvoiceReceipt({
      teamId: session.teamId,
      invoiceId,
      txHash: verification.txHash,
    }).catch(() => {});
  }

  deliverWebhook(session.teamId, "checkout.session.paid", {
    environmentId: updated.environmentId ?? null,
    checkoutSessionId: updated.id,
    paymentLinkId: updated.paymentLinkId ?? null,
    paymentLinkSlug: updated.paymentLink?.slug ?? null,
    purpose: updated.purpose,
    status: updated.status,
    amount: updated.amount,
    currency: updated.currency,
    acceptedToken: updated.acceptedToken,
    chainId: updated.chainId,
    recipientWallet: updated.recipientWallet,
    customerEmail: updated.customerEmail ?? null,
    customerWallet: updated.customerWallet ?? null,
    customerName: updated.customerName ?? null,
    companyId: updated.companyId ?? null,
    paymentId: payment.id,
    invoiceId,
    txHash: verification.txHash,
    paidAt: updated.paidAt?.toISOString() ?? null,
  }).catch(() => {});

  return { ok: true as const, session: updated, payment };
}
