import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { toSix } from "./invoices.js";

type InvoiceBalanceDb = Pick<typeof db, "invoice">;

function normalizeWallet(value?: string | null): string | null {
  return value?.trim() ? value.trim().toLowerCase() : null;
}

async function resolveCompany(input: {
  teamId: string;
  companyId?: string | null;
  walletAddress?: string | null;
}) {
  if (input.companyId) {
    return db.arcenCompany.findFirst({
      where: { id: input.companyId, teamId: input.teamId },
      select: { id: true, walletAddress: true },
    });
  }

  const walletAddress = normalizeWallet(input.walletAddress);
  if (!walletAddress) return null;

  return db.arcenCompany.findFirst({
    where: { teamId: input.teamId, walletAddress },
    select: { id: true, walletAddress: true },
  });
}

export async function ensureBillingBalance(input: {
  teamId: string;
  companyId?: string | null;
  walletAddress?: string | null;
  currency?: string;
}) {
  const company = await resolveCompany(input);
  if (!company) return null;

  return db.billingBalance.upsert({
    where: { companyId: company.id },
    update: {
      currency: input.currency ?? "USDC",
    },
    create: {
      teamId: input.teamId,
      companyId: company.id,
      availableCredit: 0,
      totalCredited: 0,
      totalDebited: 0,
      currency: input.currency ?? "USDC",
    },
  });
}

export async function postBillingCredit(input: {
  teamId: string;
  companyId?: string | null;
  walletAddress?: string | null;
  amount: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("postBillingCredit requires a positive amount");
  }

  const company = await resolveCompany(input);
  if (!company) return null;

  const balance = await ensureBillingBalance(input);
  if (!balance) return null;

  await db.billingBalance.updateMany({
    where: { id: balance.id, availableCredit: balance.availableCredit },
    data: {
      availableCredit: toSix(Number(balance.availableCredit) + input.amount),
      totalCredited: toSix(Number(balance.totalCredited) + input.amount),
      ...(input.metadata
        ? {
            metadata: toPrismaJson({
              ...(balance.metadata &&
              typeof balance.metadata === "object" &&
              !Array.isArray(balance.metadata)
                ? (balance.metadata as Record<string, unknown>)
                : {}),
              ...input.metadata,
            }),
          }
        : {}),
    },
  });

  return db.billingBalance.findUnique({ where: { id: balance.id } });
}

export async function consumeBillingCredit(input: {
  teamId: string;
  companyId?: string | null;
  walletAddress?: string | null;
  requestedAmount: number;
  metadata?: Record<string, unknown>;
}) {
  if (!Number.isFinite(input.requestedAmount) || input.requestedAmount <= 0) {
    return { appliedAmount: 0, balance: null };
  }

  const balance = await ensureBillingBalance(input);
  if (!balance) return { appliedAmount: 0, balance: null };

  const available = Number(balance.availableCredit);
  const appliedAmount = Math.min(available, input.requestedAmount);
  if (appliedAmount <= 0) {
    return { appliedAmount: 0, balance };
  }

  const updated = await db.billingBalance.updateMany({
    where: { id: balance.id, availableCredit: balance.availableCredit },
    data: {
      availableCredit: toSix(Math.max(0, available - appliedAmount)),
      totalDebited: toSix(Number(balance.totalDebited) + appliedAmount),
      lastAppliedAt: new Date(),
      ...(input.metadata
        ? {
            metadata: toPrismaJson({
              ...(balance.metadata &&
              typeof balance.metadata === "object" &&
              !Array.isArray(balance.metadata)
                ? (balance.metadata as Record<string, unknown>)
                : {}),
              ...input.metadata,
            }),
          }
        : {}),
    },
  });

  const refreshed = await db.billingBalance.findUnique({ where: { id: balance.id } });
  return { appliedAmount: updated.count > 0 ? appliedAmount : 0, balance: refreshed ?? balance };
}

export async function recomputeInvoiceBalance(
  invoiceId: string,
  client: InvoiceBalanceDb = db,
) {
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      total: true,
      amountPaid: true,
      amountCredited: true,
      issuedAt: true,
    },
  });
  if (!invoice) return null;

  const total = Number(invoice.total);
  const amountPaid = Number(invoice.amountPaid);
  const amountCredited = Number(invoice.amountCredited);
  const outstanding = Math.max(0, total - amountPaid - amountCredited);
  const nextStatus =
    outstanding <= 0 && invoice.status !== "VOID" ? "PAID" : invoice.status;

  return client.invoice.update({
    where: { id: invoiceId },
    data: {
      amountOutstanding: toSix(outstanding),
      ...(nextStatus !== invoice.status ? { status: nextStatus } : {}),
      ...(outstanding <= 0 && !invoice.issuedAt ? { issuedAt: new Date() } : {}),
      ...(outstanding <= 0 ? { paidAt: new Date() } : {}),
    },
  });
}

export async function applyInvoicePayment(input: {
  invoiceId: string;
  amount: number;
}, client: InvoiceBalanceDb = db) {
  const invoice = await client.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, amountPaid: true },
  });
  if (!invoice) return null;

  const previousAmountPaid = Number(invoice.amountPaid);
  const nextAmountPaid = toSix(previousAmountPaid + input.amount);

  await client.invoice.updateMany({
    where: { id: invoice.id, amountPaid: invoice.amountPaid },
    data: {
      amountPaid: nextAmountPaid,
    },
  });

  return recomputeInvoiceBalance(invoice.id, client);
}

export async function applyInvoiceCredit(input: {
  invoiceId: string;
  amount: number;
}) {
  const invoice = await db.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, amountCredited: true },
  });
  if (!invoice) return null;

  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      amountCredited: toSix(Number(invoice.amountCredited) + input.amount),
    },
  });

  return recomputeInvoiceBalance(invoice.id);
}

export async function recordRefund(input: {
  teamId: string;
  companyId?: string | null;
  walletAddress?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
  billingAdjustmentId?: string | null;
  amount: number;
  currency?: string;
  reason: string;
  txHash?: string | null;
  externalRef?: string | null;
  occurredAt?: Date | null;
  settledAt?: Date | null;
  status?: "PENDING" | "SETTLED" | "FAILED" | "VOIDED";
  metadata?: Record<string, unknown>;
}) {
  const company = await resolveCompany(input);
  const refund = await db.refund.create({
    data: {
      teamId: input.teamId,
      companyId: company?.id ?? null,
      invoiceId: input.invoiceId ?? null,
      paymentId: input.paymentId ?? null,
      billingAdjustmentId: input.billingAdjustmentId ?? null,
      amount: toSix(input.amount),
      currency: input.currency ?? "USDC",
      reason: input.reason,
      txHash: input.txHash ?? null,
      externalRef: input.externalRef ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      settledAt: input.settledAt ?? null,
      status: input.status ?? "PENDING",
      ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
    },
  });

  if (refund.invoiceId && refund.status === "SETTLED") {
    await applyInvoiceCredit({
      invoiceId: refund.invoiceId,
      amount: input.amount,
    });
  }

  return refund;
}
