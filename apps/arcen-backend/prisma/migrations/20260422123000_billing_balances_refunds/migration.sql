CREATE TYPE "RefundStatus" AS ENUM (
  'PENDING',
  'SETTLED',
  'FAILED',
  'VOIDED'
);

ALTER TABLE "Invoice"
  ADD COLUMN "amountPaid" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN "amountCredited" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN "amountOutstanding" DECIMAL(20, 6) NOT NULL DEFAULT 0;

UPDATE "Invoice"
SET
  "amountPaid" = CASE WHEN "status" = 'PAID' THEN "total" ELSE 0 END,
  "amountCredited" = 0,
  "amountOutstanding" = CASE WHEN "status" = 'PAID' THEN 0 ELSE "total" END;

CREATE TABLE "BillingBalance" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "teamId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "availableCredit" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  "totalCredited" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  "totalDebited" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  "lastAppliedAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "BillingBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingBalance_companyId_key" ON "BillingBalance"("companyId");
CREATE INDEX "BillingBalance_teamId_currency_updatedAt_idx" ON "BillingBalance"("teamId", "currency", "updatedAt");

ALTER TABLE "BillingBalance"
  ADD CONSTRAINT "BillingBalance_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingBalance"
  ADD CONSTRAINT "BillingBalance_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "teamId" TEXT NOT NULL,
  "companyId" TEXT,
  "invoiceId" TEXT,
  "paymentId" TEXT,
  "billingAdjustmentId" TEXT,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "amount" DECIMAL(20, 6) NOT NULL,
  "reason" TEXT NOT NULL,
  "txHash" TEXT,
  "externalRef" TEXT,
  "occurredAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Refund_txHash_key" ON "Refund"("txHash");
CREATE INDEX "Refund_teamId_status_createdAt_idx" ON "Refund"("teamId", "status", "createdAt");
CREATE INDEX "Refund_companyId_createdAt_idx" ON "Refund"("companyId", "createdAt");
CREATE INDEX "Refund_invoiceId_idx" ON "Refund"("invoiceId");
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");
CREATE INDEX "Refund_billingAdjustmentId_idx" ON "Refund"("billingAdjustmentId");

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_billingAdjustmentId_fkey"
  FOREIGN KEY ("billingAdjustmentId") REFERENCES "BillingAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
