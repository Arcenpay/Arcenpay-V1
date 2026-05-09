DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentKind') THEN
    CREATE TYPE "PaymentKind" AS ENUM (
      'SUBSCRIPTION_ACTIVATION',
      'SUBSCRIPTION_RENEWAL',
      'MANUAL_INVOICE_PAYMENT'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentStatus') THEN
    CREATE TYPE "PaymentStatus" AS ENUM (
      'PENDING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentAttemptStatus') THEN
    CREATE TYPE "PaymentAttemptStatus" AS ENUM (
      'PENDING',
      'SUCCEEDED',
      'FAILED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
    CREATE TYPE "SubscriptionStatus" AS ENUM (
      'ACTIVE',
      'PAST_DUE',
      'CANCELLED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SubscriptionState" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "teamId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "walletAddress" TEXT,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "catalogPlanId" TEXT,
  "onChainPlanId" TEXT,
  "onChainTokenId" TEXT,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "lastEvent" TEXT,
  "lastEventAt" TIMESTAMP(3),
  "lastSourceTxHash" TEXT,
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "cancelledAt" TIMESTAMP(3),
  "pastDueAt" TIMESTAMP(3),
  "graceEndsAt" TIMESTAMP(3),
  "metadata" JSONB,

  CONSTRAINT "SubscriptionState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubscriptionState_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubscriptionState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionState_companyId_key" ON "SubscriptionState"("companyId");
CREATE INDEX IF NOT EXISTS "SubscriptionState_teamId_status_idx" ON "SubscriptionState"("teamId", "status");
CREATE INDEX IF NOT EXISTS "SubscriptionState_teamId_walletAddress_idx" ON "SubscriptionState"("teamId", "walletAddress");

CREATE TABLE IF NOT EXISTS "Payment" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "teamId" TEXT NOT NULL,
  "companyId" TEXT,
  "invoiceId" TEXT,
  "subscriptionStateId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "kind" "PaymentKind" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "amount" DECIMAL(20,6) NOT NULL,
  "payerWallet" TEXT,
  "recipientWallet" TEXT,
  "acceptedToken" TEXT,
  "txHash" TEXT,
  "externalRef" TEXT,
  "occurredAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "metadata" JSONB,

  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Payment_subscriptionStateId_fkey" FOREIGN KEY ("subscriptionStateId") REFERENCES "SubscriptionState"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_txHash_key" ON "Payment"("txHash");
CREATE INDEX IF NOT EXISTS "Payment_teamId_status_occurredAt_idx" ON "Payment"("teamId", "status", "occurredAt");
CREATE INDEX IF NOT EXISTS "Payment_companyId_createdAt_idx" ON "Payment"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX IF NOT EXISTS "Payment_subscriptionStateId_idx" ON "Payment"("subscriptionStateId");

CREATE TABLE IF NOT EXISTS "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "paymentId" TEXT NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL,
  "txHash" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "metadata" JSONB,

  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PaymentAttempt_paymentId_attemptedAt_idx" ON "PaymentAttempt"("paymentId", "attemptedAt");
CREATE INDEX IF NOT EXISTS "PaymentAttempt_txHash_idx" ON "PaymentAttempt"("txHash");
