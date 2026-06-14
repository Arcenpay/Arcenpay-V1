import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  team: {
    findUnique: vi.fn(),
  },
  arcenCompany: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  catalogPlan: {
    findFirst: vi.fn(),
  },
  catalogCreditType: {
    findFirst: vi.fn(),
  },
  companyCreditGrant: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  creditLedgerEntry: {
    create: vi.fn(),
  },
  payment: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  invoice: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const mockUpsertSubscriptionLedgerState = vi.hoisted(() => vi.fn());
const mockUpsertScopedSubscriberEmail = vi.hoisted(() => vi.fn());
const mockSyncCustomerUserIdentity = vi.hoisted(() => vi.fn());
const mockIngestBillingEvent = vi.hoisted(() => vi.fn());
const mockSendPaidInvoiceReceipt = vi.hoisted(() => vi.fn());
const mockAllocateInvoiceNumber = vi.hoisted(() => vi.fn());

vi.mock("../../../src/db.js", () => ({
  db: mockDb,
}));

vi.mock("../../../src/lib/billing/billing-ledger.js", () => ({
  upsertSubscriptionLedgerState: mockUpsertSubscriptionLedgerState,
}));

vi.mock("../../../src/lib/billing/subscriber-emails.js", () => ({
  upsertScopedSubscriberEmail: mockUpsertScopedSubscriberEmail,
}));

vi.mock("../../../src/lib/billing/customer-identity.js", () => ({
  syncCustomerUserIdentity: mockSyncCustomerUserIdentity,
}));

vi.mock("../../../src/lib/billing/billing-events.js", () => ({
  ingestBillingEvent: mockIngestBillingEvent,
}));

vi.mock("../../../src/lib/billing/invoice-notifications.js", () => ({
  sendPaidInvoiceReceipt: mockSendPaidInvoiceReceipt,
}));

vi.mock("../../../src/lib/billing/invoices.js", () => ({
  allocateInvoiceNumber: mockAllocateInvoiceNumber,
  toSix: (amount: number) => amount.toFixed(6),
}));

vi.mock("../../../src/lib/billing/subscription-change-requests.js", () => ({
  updateSubscriptionChangeRequestStage: vi.fn(),
}));

vi.mock("../../../src/lib/webhooks/deliver-webhook.js", () => ({
  deliverWebhook: vi.fn(),
}));

import { finalizeSubscriptionActivation } from "../../../src/lib/billing/billing-recovery.js";

type StoredInvoice = {
  id: string;
  teamId: string;
  companyId: string | null;
  planId: string | null;
  metadata: Record<string, unknown>;
};

type StoredPayment = {
  id: string;
  invoiceId: string | null;
  txHash: string | null;
  idempotencyKey: string;
};

const activationInput = {
  teamId: "team-1",
  payload: {
    companyId: "company-1",
    environmentId: "env-1",
    walletAddress: "0xFFe5822605BbF11cB9c5e4B7c1369d4fb4410e8",
    catalogPlanId: "plan-pro",
    catalogPlanName: "Pro",
    billingPeriod: "monthly" as const,
    customerName: "Ada",
    subscriberEmail: "ada@example.com",
    onChainPlanId: "7",
    onChainTokenId: "101",
    expiration: "2026-06-30T00:00:00.000Z",
    txHash: "0xactivationtx",
    amount: 2,
    currency: "USDC",
    merchantAddress: "0xmerchant",
    acceptedToken: "0xtoken",
    occurredAt: "2026-05-30T00:00:00.000Z",
  },
};

function setupActivationStores(options: { rollbackCreatedInvoice?: boolean } = {}) {
  const invoices: StoredInvoice[] = [];
  const payments: StoredPayment[] = [];

  mockDb.$transaction.mockImplementation(async (callback: any) =>
    callback(mockDb),
  );
  mockDb.team.findUnique.mockResolvedValue({
    slug: "workspace",
    invoicePrefix: "INV-WORKSPACE",
    environmentMode: "DEVELOPMENT",
  });
  mockDb.arcenCompany.findUnique.mockResolvedValue({
    name: null,
    email: null,
    walletAddress: null,
    traits: {},
  });
  mockDb.arcenCompany.update.mockResolvedValue({});
  mockDb.catalogPlan.findFirst.mockResolvedValue({
    id: activationInput.payload.catalogPlanId,
    environmentId: activationInput.payload.environmentId,
    metadata: {},
  });
  mockDb.catalogCreditType.findFirst.mockResolvedValue(null);
  mockDb.companyCreditGrant.findFirst.mockResolvedValue(null);
  mockUpsertScopedSubscriberEmail.mockResolvedValue({});
  mockUpsertSubscriptionLedgerState.mockResolvedValue({ id: "state-1" });
  mockSyncCustomerUserIdentity.mockResolvedValue({});
  mockIngestBillingEvent.mockResolvedValue({
    processedNow: false,
    deduped: true,
  });
  mockSendPaidInvoiceReceipt.mockResolvedValue({
    sent: true,
  });
  mockAllocateInvoiceNumber.mockImplementation(async () =>
    `INV-WORKSPACE-2026-${String(invoices.length + 1).padStart(6, "0")}`,
  );

  mockDb.payment.findFirst.mockImplementation(async ({ where }: any) => {
    const txHash = where?.txHash ?? where?.OR?.find((entry: any) => entry.txHash)?.txHash;
    const idempotencyKey =
      where?.idempotencyKey ??
      where?.OR?.find((entry: any) => entry.idempotencyKey)?.idempotencyKey;

    return (
      payments.find(
        (payment) =>
          (txHash && payment.txHash === txHash) ||
          (idempotencyKey && payment.idempotencyKey === idempotencyKey),
      ) ?? null
    );
  });

  mockDb.invoice.findUnique.mockImplementation(async ({ where }: any) =>
    invoices.find((invoice) => invoice.id === where.id) ?? null,
  );

  mockDb.invoice.findFirst.mockImplementation(async ({ where }: any) => {
    const txHash = where?.metadata?.equals;
    return (
      invoices.find(
        (invoice) =>
          invoice.teamId === where.teamId &&
          invoice.companyId === where.companyId &&
          invoice.planId === where.planId &&
          invoice.metadata.txHash === txHash,
      ) ?? null
    );
  });

  mockDb.invoice.create.mockImplementation(async ({ data }: any) => {
    const invoice = {
      id: `invoice-${invoices.length + 1}`,
      teamId: data.teamId,
      companyId: data.companyId,
      planId: data.planId,
      metadata: data.metadata,
    };

    if (!options.rollbackCreatedInvoice) {
      invoices.push(invoice);
    }

    return invoice;
  });

  mockDb.payment.create.mockImplementation(async ({ data }: any) => {
    const payment = {
      id: `payment-${payments.length + 1}`,
      invoiceId: data.invoiceId,
      txHash: data.txHash,
      idempotencyKey: data.idempotencyKey,
    };
    payments.push(payment);
    return payment;
  });

  mockDb.payment.update.mockImplementation(async ({ where, data }: any) => {
    const payment = payments.find((entry) => entry.id === where.id);
    if (payment) {
      payment.invoiceId = data.invoiceId ?? payment.invoiceId;
    }
    return payment;
  });

  return { invoices, payments };
}

describe("finalizeSubscriptionActivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses the same invoice and payment when the same activation tx is retried", async () => {
    setupActivationStores();

    const first = await finalizeSubscriptionActivation(activationInput);
    const second = await finalizeSubscriptionActivation(activationInput);

    expect(first.invoiceId).toBe("invoice-1");
    expect(second.invoiceId).toBe("invoice-1");
    expect(first.paymentId).toBe("payment-1");
    expect(second.paymentId).toBe("payment-1");
    expect(mockDb.invoice.create).toHaveBeenCalledTimes(1);
    expect(mockDb.payment.create).toHaveBeenCalledTimes(1);
  });

  it("falls back to the original records when a concurrent activation hits payment uniqueness", async () => {
    const { invoices, payments } = setupActivationStores({
      rollbackCreatedInvoice: true,
    });
    const uniqueError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });

    mockDb.payment.create.mockImplementationOnce(async () => {
      invoices.push({
        id: "invoice-winner",
        teamId: activationInput.teamId,
        companyId: activationInput.payload.companyId,
        planId: activationInput.payload.catalogPlanId,
        metadata: { txHash: activationInput.payload.txHash },
      });
      payments.push({
        id: "payment-winner",
        invoiceId: "invoice-winner",
        txHash: activationInput.payload.txHash,
        idempotencyKey: `payment:subscription.activate:${activationInput.payload.txHash}`,
      });
      throw uniqueError;
    });

    const result = await finalizeSubscriptionActivation(activationInput);

    expect(result.invoiceId).toBe("invoice-winner");
    expect(result.paymentId).toBe("payment-winner");
    expect(mockDb.invoice.create).toHaveBeenCalledTimes(1);
    expect(mockDb.payment.create).toHaveBeenCalledTimes(1);
    expect(invoices).toHaveLength(1);
    expect(payments).toHaveLength(1);
  });
});
