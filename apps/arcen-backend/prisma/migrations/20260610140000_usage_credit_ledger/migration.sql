-- Usage credit accounting: company grants, balances, and immutable ledger entries.

CREATE TYPE "CompanyCreditGrantStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');
CREATE TYPE "CompanyCreditGrantSource" AS ENUM ('PLAN_GRANT', 'CREDIT_BUNDLE', 'ADMIN', 'ADJUSTMENT');
CREATE TYPE "CreditLedgerEntryKind" AS ENUM ('GRANT', 'CONSUME', 'REFUND', 'ADJUSTMENT', 'EXPIRE', 'REVOKE');

CREATE TABLE "CompanyCreditGrant" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "teamId" TEXT NOT NULL,
  "environmentId" TEXT,
  "companyId" TEXT NOT NULL,
  "creditTypeId" TEXT NOT NULL,
  "status" "CompanyCreditGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "CompanyCreditGrantSource" NOT NULL,
  "initialAmount" INTEGER NOT NULL,
  "remainingAmount" INTEGER NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "periodStartedAt" TIMESTAMP(3),
  "periodEndsAt" TIMESTAMP(3),
  "resetPeriod" TEXT,
  "paymentId" TEXT,
  "checkoutSessionId" TEXT,
  "idempotencyKey" TEXT,
  "metadata" JSONB,

  CONSTRAINT "CompanyCreditGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditLedgerEntry" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "teamId" TEXT NOT NULL,
  "environmentId" TEXT,
  "companyId" TEXT NOT NULL,
  "creditTypeId" TEXT NOT NULL,
  "grantId" TEXT,
  "kind" "CreditLedgerEntryKind" NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER,
  "featureKey" TEXT,
  "eventId" TEXT,
  "paymentId" TEXT,
  "checkoutSessionId" TEXT,
  "idempotencyKey" TEXT,
  "metadata" JSONB,

  CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyCreditGrant_teamId_idempotencyKey_key" ON "CompanyCreditGrant"("teamId", "idempotencyKey");
CREATE INDEX "CompanyCreditGrant_teamId_environmentId_companyId_creditTypeId_status_idx" ON "CompanyCreditGrant"("teamId", "environmentId", "companyId", "creditTypeId", "status");
CREATE INDEX "CompanyCreditGrant_teamId_creditTypeId_status_idx" ON "CompanyCreditGrant"("teamId", "creditTypeId", "status");
CREATE INDEX "CompanyCreditGrant_companyId_creditTypeId_status_expiresAt_idx" ON "CompanyCreditGrant"("companyId", "creditTypeId", "status", "expiresAt");
CREATE INDEX "CompanyCreditGrant_paymentId_idx" ON "CompanyCreditGrant"("paymentId");
CREATE INDEX "CompanyCreditGrant_checkoutSessionId_idx" ON "CompanyCreditGrant"("checkoutSessionId");

CREATE UNIQUE INDEX "CreditLedgerEntry_teamId_idempotencyKey_key" ON "CreditLedgerEntry"("teamId", "idempotencyKey");
CREATE INDEX "CreditLedgerEntry_teamId_environmentId_companyId_creditTypeId_occurredAt_idx" ON "CreditLedgerEntry"("teamId", "environmentId", "companyId", "creditTypeId", "occurredAt");
CREATE INDEX "CreditLedgerEntry_companyId_creditTypeId_occurredAt_idx" ON "CreditLedgerEntry"("companyId", "creditTypeId", "occurredAt");
CREATE INDEX "CreditLedgerEntry_grantId_idx" ON "CreditLedgerEntry"("grantId");
CREATE INDEX "CreditLedgerEntry_eventId_idx" ON "CreditLedgerEntry"("eventId");
CREATE INDEX "CreditLedgerEntry_paymentId_idx" ON "CreditLedgerEntry"("paymentId");
CREATE INDEX "CreditLedgerEntry_checkoutSessionId_idx" ON "CreditLedgerEntry"("checkoutSessionId");

ALTER TABLE "CompanyCreditGrant"
  ADD CONSTRAINT "CompanyCreditGrant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanyCreditGrant_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanyCreditGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanyCreditGrant_creditTypeId_fkey" FOREIGN KEY ("creditTypeId") REFERENCES "CatalogCreditType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanyCreditGrant_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanyCreditGrant_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "CheckoutSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CreditLedgerEntry"
  ADD CONSTRAINT "CreditLedgerEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CreditLedgerEntry_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CreditLedgerEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CreditLedgerEntry_creditTypeId_fkey" FOREIGN KEY ("creditTypeId") REFERENCES "CatalogCreditType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CreditLedgerEntry_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "CompanyCreditGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CreditLedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CreditLedgerEntry_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "CheckoutSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
