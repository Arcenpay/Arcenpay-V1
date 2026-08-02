import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { toSix } from "./invoices.js";
import { applyInvoicePayment } from "./billing-balances.js";
import { normalizeWallet } from "./utils.js";

type BillingLedgerDb = Pick<
  typeof db,
  | "arcenCompany"
  | "subscriptionState"
  | "payment"
  | "paymentAttempt"
  | "invoice"
>;

async function resolveCompany(
  input: {
    teamId: string;
    companyId?: string | null;
    walletAddress?: string | null;
    onChainTokenId?: string | null;
  },
  client: BillingLedgerDb = db,
) {
  if (input.companyId) {
    return client.arcenCompany.findFirst({
      where: { id: input.companyId, teamId: input.teamId },
      select: {
        id: true,
        teamId: true,
        environmentId: true,
        walletAddress: true,
        activePlanId: true,
      },
    });
  }

  const onChainTokenId = input.onChainTokenId?.trim();
  if (onChainTokenId) {
    const companyByToken = await client.subscriptionState.findFirst({
      where: { teamId: input.teamId, onChainTokenId },
      select: {
        company: {
          select: {
            id: true,
            teamId: true,
            environmentId: true,
            walletAddress: true,
            activePlanId: true,
          },
        },
      },
    });

    if (companyByToken?.company) {
      return companyByToken.company;
    }
  }

  const walletAddress = normalizeWallet(input.walletAddress);
  if (!walletAddress) return null;

  const companyByIdentityWallet = await client.arcenCompany.findFirst({
    where: { teamId: input.teamId, walletAddress },
    select: {
      id: true,
      teamId: true,
      environmentId: true,
      walletAddress: true,
      activePlanId: true,
    },
  });
  if (companyByIdentityWallet) {
    return companyByIdentityWallet;
  }

  const subscriptionMatch = await client.subscriptionState.findFirst({
    where: { teamId: input.teamId, walletAddress },
    select: {
      company: {
        select: {
          id: true,
          teamId: true,
          environmentId: true,
          walletAddress: true,
          activePlanId: true,
        },
      },
    },
  });

  return subscriptionMatch?.company ?? null;
}

export async function upsertSubscriptionLedgerState(
  input: {
    teamId: string;
    environmentId?: string | null;
    companyId?: string | null;
    walletAddress?: string | null;
    onChainTokenId?: string | null;
    chainId?: number | null;
    status: "ACTIVE" | "PAST_DUE" | "CANCELLED";
    catalogPlanId?: string | null;
    onChainPlanId?: string | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    cancelAtPeriodEnd?: boolean;
    cancelledAt?: Date | null;
    pastDueAt?: Date | null;
    graceEndsAt?: Date | null;
    lastEvent?: string | null;
    lastEventAt?: Date | null;
    lastSourceTxHash?: string | null;
    metadata?: Record<string, unknown>;
  },
  client: BillingLedgerDb = db,
) {
  const company = await resolveCompany(input, client);
  if (!company) return null;

  const nextCatalogPlanId =
    input.catalogPlanId !== undefined
      ? input.catalogPlanId
      : (company.activePlanId ?? null);
  const resolvedEnvironmentId =
    input.environmentId !== undefined
      ? input.environmentId
      : (company.environmentId ?? null);
  const subscriptionState = await client.subscriptionState.upsert({
    where: { companyId: company.id },
    update: {
      environmentId: resolvedEnvironmentId,
      walletAddress:
        normalizeWallet(input.walletAddress) ?? company.walletAddress ?? null,
      status: input.status,
      ...(input.chainId != null ? { chainId: input.chainId } : {}),
      ...(input.catalogPlanId !== undefined
        ? { catalogPlanId: input.catalogPlanId }
        : {}),
      ...(input.onChainPlanId !== undefined
        ? { onChainPlanId: input.onChainPlanId }
        : {}),
      ...(input.onChainTokenId !== undefined
        ? { onChainTokenId: input.onChainTokenId }
        : {}),
      ...(input.currentPeriodStart !== undefined
        ? { currentPeriodStart: input.currentPeriodStart }
        : {}),
      ...(input.currentPeriodEnd !== undefined
        ? { currentPeriodEnd: input.currentPeriodEnd }
        : {}),
      ...(input.cancelAtPeriodEnd !== undefined
        ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd }
        : {}),
      ...(input.cancelledAt !== undefined
        ? { cancelledAt: input.cancelledAt }
        : {}),
      ...(input.pastDueAt !== undefined ? { pastDueAt: input.pastDueAt } : {}),
      ...(input.graceEndsAt !== undefined
        ? { graceEndsAt: input.graceEndsAt }
        : {}),
      ...(input.lastEvent !== undefined ? { lastEvent: input.lastEvent } : {}),
      ...(input.lastEventAt !== undefined
        ? { lastEventAt: input.lastEventAt }
        : {}),
      ...(input.lastSourceTxHash !== undefined
        ? { lastSourceTxHash: input.lastSourceTxHash }
        : {}),
      ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
    },
    create: {
      teamId: input.teamId,
      environmentId: resolvedEnvironmentId,
      companyId: company.id,
      walletAddress:
        normalizeWallet(input.walletAddress) ?? company.walletAddress ?? null,
      status: input.status,
      ...(input.chainId != null ? { chainId: input.chainId } : {}),
      catalogPlanId: nextCatalogPlanId,
      onChainPlanId: input.onChainPlanId ?? null,
      onChainTokenId: input.onChainTokenId ?? null,
      currentPeriodStart: input.currentPeriodStart ?? null,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      cancelledAt: input.cancelledAt ?? null,
      pastDueAt: input.pastDueAt ?? null,
      graceEndsAt: input.graceEndsAt ?? null,
      lastEvent: input.lastEvent ?? null,
      lastEventAt: input.lastEventAt ?? null,
      lastSourceTxHash: input.lastSourceTxHash ?? null,
      ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
    },
  });

  if (input.status === "ACTIVE" || input.status === "PAST_DUE") {
    await client.arcenCompany.update({
      where: { id: company.id },
      data: {
        ...(nextCatalogPlanId !== undefined
          ? { activePlanId: nextCatalogPlanId }
          : {}),
      },
    });
  }

  return subscriptionState;
}

async function resolvePaymentRecord(
  input: {
    idempotencyKey: string;
    txHash?: string | null;
  },
  client: BillingLedgerDb = db,
) {
  if (input.txHash) {
    const existingByTxHash = await client.payment.findUnique({
      where: { txHash: input.txHash },
    });
    if (existingByTxHash) return existingByTxHash;
  }

  return client.payment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
}

export async function recordSuccessfulPayment(
  input: {
    idempotencyKey: string;
    teamId: string;
    environmentId?: string | null;
    companyId?: string | null;
    walletAddress?: string | null;
    onChainTokenId?: string | null;
    invoiceId?: string | null;
    subscriptionStateId?: string | null;
    kind:
      | "SUBSCRIPTION_ACTIVATION"
      | "SUBSCRIPTION_RENEWAL"
      | "SUBSCRIPTION_PLAN_CHANGE_UPGRADE"
      | "MANUAL_INVOICE_PAYMENT"
      | "ADDON_PURCHASE"
      | "CUSTOM_PAYMENT";
    amount: number;
    currency?: string;
    payerWallet?: string | null;
    recipientWallet?: string | null;
    acceptedToken?: string | null;
    txHash?: string | null;
    externalRef?: string | null;
    occurredAt?: Date | null;
    settledAt?: Date | null;
    metadata?: Record<string, unknown>;
    preserveScheduledCancellation?: boolean;
  },
  client: BillingLedgerDb = db,
) {
  const company = await resolveCompany(input, client);
  const subscriptionState = input.subscriptionStateId
    ? await client.subscriptionState.findUnique({
        where: { id: input.subscriptionStateId },
        select: { id: true, environmentId: true },
      })
    : company
      ? await client.subscriptionState.findUnique({
          where: { companyId: company.id },
          select: { id: true, environmentId: true },
        })
      : null;
  const resolvedEnvironmentId =
    input.environmentId !== undefined
      ? input.environmentId
      : (subscriptionState?.environmentId ?? company?.environmentId ?? null);

  const existing = await resolvePaymentRecord(
    {
      idempotencyKey: input.idempotencyKey,
      txHash: input.txHash,
    },
    client,
  );

  const payment = existing
    ? await client.payment.update({
        where: { id: existing.id },
        data: {
          status: "SUCCEEDED",
          amount: toSix(input.amount),
          currency: input.currency ?? "USDC",
          teamId: input.teamId,
          environmentId: resolvedEnvironmentId,
          companyId: company?.id ?? null,
          invoiceId: input.invoiceId ?? null,
          subscriptionStateId: subscriptionState?.id ?? null,
          payerWallet: normalizeWallet(input.payerWallet),
          recipientWallet: normalizeWallet(input.recipientWallet),
          acceptedToken: normalizeWallet(input.acceptedToken),
          txHash: input.txHash ?? existing.txHash,
          externalRef: input.externalRef ?? null,
          occurredAt: input.occurredAt ?? null,
          settledAt: input.settledAt ?? input.occurredAt ?? new Date(),
          failedAt: null,
          ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
        },
      })
    : await client.payment.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          teamId: input.teamId,
          environmentId: resolvedEnvironmentId,
          companyId: company?.id ?? null,
          invoiceId: input.invoiceId ?? null,
          subscriptionStateId: subscriptionState?.id ?? null,
          kind: input.kind,
          status: "SUCCEEDED",
          amount: toSix(input.amount),
          currency: input.currency ?? "USDC",
          payerWallet: normalizeWallet(input.payerWallet),
          recipientWallet: normalizeWallet(input.recipientWallet),
          acceptedToken: normalizeWallet(input.acceptedToken),
          txHash: input.txHash ?? null,
          externalRef: input.externalRef ?? null,
          occurredAt: input.occurredAt ?? null,
          settledAt: input.settledAt ?? input.occurredAt ?? new Date(),
          ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
        },
      });

  const existingAttempt = await client.paymentAttempt.findFirst({
    where: {
      paymentId: payment.id,
      status: "SUCCEEDED",
      txHash: input.txHash ?? null,
    },
    select: { id: true },
  });

  if (!existingAttempt) {
    await client.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        status: "SUCCEEDED",
        txHash: input.txHash ?? null,
        attemptedAt: input.occurredAt ?? new Date(),
        resolvedAt: input.settledAt ?? input.occurredAt ?? new Date(),
        ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
      },
    });
  }

  if (subscriptionState?.id) {
    const updateData: Record<string, unknown> = {
      status: "ACTIVE",
      pastDueAt: null,
      graceEndsAt: null,
    };
    if (!input.preserveScheduledCancellation) {
      updateData["cancelAtPeriodEnd"] = false;
      updateData["cancelledAt"] = null;
    }
    await client.subscriptionState.update({
      where: { id: subscriptionState.id },
      data: updateData,
    });
  }

  if (input.invoiceId) {
    await applyInvoicePayment(
      {
        invoiceId: input.invoiceId,
        amount: input.amount,
      },
      client,
    );
  }

  return payment;
}

export async function recordFailedPayment(input: {
  idempotencyKey: string;
  teamId: string;
  companyId?: string | null;
  walletAddress?: string | null;
  onChainTokenId?: string | null;
  subscriptionStateId?: string | null;
  kind:
    | "SUBSCRIPTION_ACTIVATION"
    | "SUBSCRIPTION_RENEWAL"
    | "SUBSCRIPTION_PLAN_CHANGE_UPGRADE"
    | "MANUAL_INVOICE_PAYMENT"
    | "ADDON_PURCHASE"
    | "CUSTOM_PAYMENT";
  amount?: number;
  currency?: string;
  txHash?: string | null;
  occurredAt?: Date | null;
  errorMessage: string;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const company = await resolveCompany(input);
  const subscriptionState = input.subscriptionStateId
    ? await db.subscriptionState.findUnique({
        where: { id: input.subscriptionStateId },
        select: { id: true },
      })
    : company
      ? await db.subscriptionState.findUnique({
          where: { companyId: company.id },
          select: { id: true },
        })
      : null;

  const occurredAt = input.occurredAt ?? new Date();
  const graceEndsAt = new Date(occurredAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  const existing = await resolvePaymentRecord({
    idempotencyKey: input.idempotencyKey,
    txHash: input.txHash,
  });

  const payment = existing
    ? await db.payment.update({
        where: { id: existing.id },
        data: {
          status: "FAILED",
          teamId: input.teamId,
          companyId: company?.id ?? null,
          subscriptionStateId: subscriptionState?.id ?? null,
          amount: toSix(input.amount ?? 0),
          currency: input.currency ?? "USDC",
          txHash: input.txHash ?? existing.txHash,
          occurredAt,
          failedAt: occurredAt,
          ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
        },
      })
    : await db.payment.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          teamId: input.teamId,
          companyId: company?.id ?? null,
          subscriptionStateId: subscriptionState?.id ?? null,
          kind: input.kind,
          status: "FAILED",
          amount: toSix(input.amount ?? 0),
          currency: input.currency ?? "USDC",
          txHash: input.txHash ?? null,
          occurredAt,
          failedAt: occurredAt,
          ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
        },
      });

  await db.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      status: "FAILED",
      txHash: input.txHash ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage,
      attemptedAt: occurredAt,
      resolvedAt: occurredAt,
      ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
    },
  });

  if (subscriptionState?.id) {
    await db.subscriptionState.update({
      where: { id: subscriptionState.id },
      data: {
        status: "PAST_DUE",
        pastDueAt: occurredAt,
        graceEndsAt,
      },
    });
  }

  return payment;
}
