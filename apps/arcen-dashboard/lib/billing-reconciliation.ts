import { db } from "@/lib/db";

export async function getBillingReconciliationSummary(input: {
  teamId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  const [
    paidInvoicesWithoutPaymentRows,
    activeCompaniesWithoutSubscriptionStateRows,
    pastDueBeyondGraceRows,
    failedPaymentsWithoutPastDueRows,
    renewalEvents,
    paymentRows,
    pendingRecoveryTasks,
  ] = await Promise.all([
    db.invoice.findMany({
      where: {
        teamId: input.teamId,
        status: "PAID",
        payments: { none: {} },
      },
      select: { id: true, number: true, paidAt: true },
      take: 50,
      orderBy: { updatedAt: "desc" },
    }),
    db.arcenCompany.findMany({
      where: {
        teamId: input.teamId,
        activePlanId: { not: null },
        subscriptionState: null,
      },
      select: { id: true, activePlanId: true, walletAddress: true },
      take: 50,
      orderBy: { updatedAt: "desc" },
    }),
    db.subscriptionState.findMany({
      where: {
        teamId: input.teamId,
        status: "PAST_DUE",
        graceEndsAt: { lte: now },
      },
      select: {
        id: true,
        companyId: true,
        catalogPlanId: true,
        graceEndsAt: true,
      },
      take: 50,
      orderBy: { graceEndsAt: "asc" },
    }),
    db.payment.findMany({
      where: {
        teamId: input.teamId,
        status: "FAILED",
        OR: [
          { subscriptionState: null },
          { subscriptionState: { is: { status: { not: "PAST_DUE" } } } },
        ],
      },
      select: {
        id: true,
        kind: true,
        txHash: true,
        subscriptionStateId: true,
      },
      take: 50,
      orderBy: { updatedAt: "desc" },
    }),
    db.billingEvent.findMany({
      where: {
        teamId: input.teamId,
        eventType: "SUBSCRIPTION_RENEWED",
        processed: true,
      },
      select: {
        id: true,
        idempotencyKey: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    db.payment.findMany({
      where: {
        teamId: input.teamId,
        kind: "SUBSCRIPTION_RENEWAL",
      },
      select: { idempotencyKey: true },
      take: 1000,
      orderBy: { createdAt: "desc" },
    }),
    db.billingRecoveryTask.findMany({
      where: {
        teamId: input.teamId,
        status: { in: ["PENDING", "FAILED"] },
      },
      select: {
        id: true,
        kind: true,
        status: true,
        txHash: true,
        lastError: true,
        nextAttemptAt: true,
      },
      take: 50,
      orderBy: [{ createdAt: "asc" }, { updatedAt: "asc" }],
    }),
  ]);

  const paymentKeys = new Set(paymentRows.map((row) => row.idempotencyKey));
  const renewalEventsWithoutPaymentRows = renewalEvents
    .filter((event) => !paymentKeys.has(`payment:${event.idempotencyKey}`))
    .slice(0, 50)
    .map((event) => ({
      id: event.id,
      idempotencyKey: event.idempotencyKey,
      createdAt: event.createdAt,
    }));

  return {
    generatedAt: now.toISOString(),
    counts: {
      paidInvoicesWithoutPayment: paidInvoicesWithoutPaymentRows.length,
      activeCompaniesWithoutSubscriptionState:
        activeCompaniesWithoutSubscriptionStateRows.length,
      pastDueBeyondGrace: pastDueBeyondGraceRows.length,
      failedPaymentsWithoutPastDueState:
        failedPaymentsWithoutPastDueRows.length,
      renewalEventsWithoutPayment: renewalEventsWithoutPaymentRows.length,
      pendingRecoveryTasks: pendingRecoveryTasks.length,
    },
    samples: {
      paidInvoicesWithoutPayment: paidInvoicesWithoutPaymentRows,
      activeCompaniesWithoutSubscriptionState:
        activeCompaniesWithoutSubscriptionStateRows,
      pastDueBeyondGrace: pastDueBeyondGraceRows,
      failedPaymentsWithoutPastDueState: failedPaymentsWithoutPastDueRows,
      renewalEventsWithoutPayment: renewalEventsWithoutPaymentRows,
      pendingRecoveryTasks,
    },
  };
}
