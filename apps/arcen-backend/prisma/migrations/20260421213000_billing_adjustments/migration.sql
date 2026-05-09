-- CreateEnum
CREATE TYPE "BillingAdjustmentKind" AS ENUM (
  'UPGRADE_PRORATION_CHARGE',
  'DOWNGRADE_PRORATION_CREDIT',
  'MANUAL_CREDIT',
  'MANUAL_DEBIT'
);

-- CreateEnum
CREATE TYPE "BillingAdjustmentStatus" AS ENUM (
  'PENDING',
  'POSTED',
  'VOIDED'
);

-- AlterEnum
ALTER TYPE "PaymentKind" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_PLAN_CHANGE_UPGRADE';

-- CreateTable
CREATE TABLE "BillingAdjustment" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "teamId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "subscriptionStateId" TEXT,
  "paymentId" TEXT,
  "kind" "BillingAdjustmentKind" NOT NULL,
  "status" "BillingAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "amount" DECIMAL(20,6) NOT NULL,
  "fromCatalogPlanId" TEXT,
  "toCatalogPlanId" TEXT,
  "periodStartedAt" TIMESTAMP(3),
  "periodEndsAt" TIMESTAMP(3),
  "effectiveAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "metadata" JSONB,

  CONSTRAINT "BillingAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingAdjustment_teamId_status_createdAt_idx" ON "BillingAdjustment"("teamId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAdjustment_companyId_createdAt_idx" ON "BillingAdjustment"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAdjustment_subscriptionStateId_createdAt_idx" ON "BillingAdjustment"("subscriptionStateId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAdjustment_paymentId_idx" ON "BillingAdjustment"("paymentId");

-- AddForeignKey
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_subscriptionStateId_fkey" FOREIGN KEY ("subscriptionStateId") REFERENCES "SubscriptionState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
