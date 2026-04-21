import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  recordFailedPayment,
  recordSuccessfulPayment,
  upsertSubscriptionLedgerState,
} from "../lib/billing-ledger";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readOccurredAt(payload: Record<string, unknown>, fallback: Date): Date {
  const event = asRecord(payload._event);
  const raw = typeof event.occurredAt === "string" ? event.occurredAt : null;
  return raw ? new Date(raw) : fallback;
}

async function backfillSubscriptionStates() {
  const companies = await db.arcenCompany.findMany({
    select: {
      id: true,
      teamId: true,
      walletAddress: true,
      activePlanId: true,
      traits: true,
    },
  });

  for (const company of companies) {
    const traits = asRecord(company.traits);
    const syncMeta = asRecord(traits.subscriptionSyncMeta);
    const lastEvent =
      typeof syncMeta.event === "string"
        ? syncMeta.event === "minted"
          ? "subscription.minted"
          : syncMeta.event === "renewed"
            ? "subscription.renewed"
            : syncMeta.event === "cancelled"
              ? "subscription.cancelled"
              : null
        : null;

    const lastEventAt =
      typeof syncMeta.occurredAt === "string"
        ? new Date(syncMeta.occurredAt)
        : null;
    const status =
      syncMeta.event === "cancelled"
        ? "CANCELLED"
        : company.activePlanId
          ? "ACTIVE"
          : "CANCELLED";

    await upsertSubscriptionLedgerState({
      teamId: company.teamId,
      companyId: company.id,
      walletAddress: company.walletAddress,
      status,
      catalogPlanId: company.activePlanId,
      onChainPlanId:
        typeof syncMeta.onChainPlanId === "string" ? syncMeta.onChainPlanId : null,
      onChainTokenId:
        typeof syncMeta.sourceTokenId === "string"
          ? syncMeta.sourceTokenId
          : null,
      cancelledAt: status === "CANCELLED" ? lastEventAt : null,
      lastEvent,
      lastEventAt,
      lastSourceTxHash:
        typeof syncMeta.sourceTxHash === "string" ? syncMeta.sourceTxHash : null,
      metadata: {
        source: "backfill",
      },
    });
  }

  return companies.length;
}

async function backfillBillingEvents() {
  const events = await db.billingEvent.findMany({
    where: {
      eventType: { in: ["SUBSCRIPTION_MINTED", "SUBSCRIPTION_RENEWED", "PAYMENT_FAILED"] },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const event of events) {
    const payload = asRecord(event.payload);
    const amount = Number(payload.amount ?? 0);
    const occurredAt = readOccurredAt(payload, event.createdAt);

    if (
      event.eventType === "SUBSCRIPTION_MINTED" ||
      event.eventType === "SUBSCRIPTION_RENEWED"
    ) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      await recordSuccessfulPayment({
        idempotencyKey: `payment:${event.idempotencyKey}`,
        teamId: event.teamId,
        companyId: typeof payload.companyId === "string" ? payload.companyId : null,
        walletAddress:
          typeof payload.customerWallet === "string"
            ? payload.customerWallet
            : typeof payload.subscriber === "string"
              ? payload.subscriber
              : null,
        kind:
          event.eventType === "SUBSCRIPTION_MINTED"
            ? "SUBSCRIPTION_ACTIVATION"
            : "SUBSCRIPTION_RENEWAL",
        amount,
        currency: "USDC",
        payerWallet:
          typeof payload.customerWallet === "string"
            ? payload.customerWallet
            : typeof payload.subscriber === "string"
              ? payload.subscriber
              : null,
        txHash: typeof payload.txHash === "string" ? payload.txHash : null,
        occurredAt,
        settledAt: occurredAt,
        metadata: {
          source: "backfill.billingEvent",
          billingEventId: event.id,
          ...payload,
        },
      });
      continue;
    }

    if (event.eventType === "PAYMENT_FAILED") {
      await recordFailedPayment({
        idempotencyKey: `payment:${event.idempotencyKey}`,
        teamId: event.teamId,
        companyId: typeof payload.companyId === "string" ? payload.companyId : null,
        walletAddress:
          typeof payload.customerWallet === "string"
            ? payload.customerWallet
            : typeof payload.subscriber === "string"
              ? payload.subscriber
              : null,
        kind: "SUBSCRIPTION_RENEWAL",
        amount: Number.isFinite(amount) ? amount : 0,
        currency: "USDC",
        txHash: typeof payload.txHash === "string" ? payload.txHash : null,
        occurredAt,
        errorMessage:
          typeof payload.error === "string"
            ? payload.error
            : "Subscription renewal failed",
        metadata: {
          source: "backfill.billingEvent",
          billingEventId: event.id,
          ...payload,
        },
      });
    }
  }

  return events.length;
}

async function backfillPaidInvoices() {
  const invoices = await db.invoice.findMany({
    where: { status: "PAID" },
    select: {
      id: true,
      teamId: true,
      customerWallet: true,
      currency: true,
      total: true,
      paidAt: true,
      number: true,
      metadata: true,
    },
  });

  for (const invoice of invoices) {
    const metadata = asRecord(invoice.metadata);
    const paymentProof = asRecord(metadata.paymentProof);
    const txHash =
      typeof paymentProof.txHash === "string" ? paymentProof.txHash : null;
    if (!txHash) continue;

    await recordSuccessfulPayment({
      idempotencyKey: `payment:invoice.paid:${invoice.id}:${txHash}`,
      teamId: invoice.teamId,
      walletAddress: invoice.customerWallet,
      invoiceId: invoice.id,
      kind: "MANUAL_INVOICE_PAYMENT",
      amount: Number(invoice.total),
      currency: invoice.currency,
      payerWallet:
        typeof paymentProof.payerWallet === "string"
          ? paymentProof.payerWallet
          : invoice.customerWallet,
      recipientWallet:
        typeof paymentProof.recipientWallet === "string"
          ? paymentProof.recipientWallet
          : null,
      txHash,
      occurredAt: invoice.paidAt ?? new Date(),
      settledAt: invoice.paidAt ?? new Date(),
      metadata: {
        source: "backfill.invoice",
        invoiceNumber: invoice.number,
      },
    });
  }

  return invoices.length;
}

async function main() {
  console.log("Starting billing ledger backfill...");

  const companies = await backfillSubscriptionStates();
  const events = await backfillBillingEvents();
  const invoices = await backfillPaidInvoices();

  console.log(
    JSON.stringify(
      {
        ok: true,
        companies,
        billingEvents: events,
        paidInvoices: invoices,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error("Billing ledger backfill failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end();
  });
