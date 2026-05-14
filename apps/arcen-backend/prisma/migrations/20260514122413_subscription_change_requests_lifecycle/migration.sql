-- CreateEnum
CREATE TYPE "SubscriptionChangeType" AS ENUM ('UPGRADE', 'DOWNGRADE', 'CANCELLATION', 'RESUME', 'BILLING_PERIOD_CHANGE');

-- CreateEnum
CREATE TYPE "SubscriptionChangeStage" AS ENUM ('REQUESTED', 'PENDING_VERIFICATION', 'PENDING_RECOVERY', 'APPLIED', 'FAILED', 'REVERTED');

-- CreateEnum
CREATE TYPE "SubscriptionChangeSource" AS ENUM ('SELF_SERVICE', 'ADMIN', 'RECOVERY', 'SYNC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BillingRecoveryTaskKind" ADD VALUE 'SUBSCRIPTION_PLAN_CHANGE';
ALTER TYPE "BillingRecoveryTaskKind" ADD VALUE 'SUBSCRIPTION_CANCELLATION';
ALTER TYPE "BillingRecoveryTaskKind" ADD VALUE 'SUBSCRIPTION_RESUME';

-- CreateTable
CREATE TABLE "SubscriptionChangeRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "environmentId" TEXT,
    "companyId" TEXT NOT NULL,
    "subscriptionStateId" TEXT,
    "changeType" "SubscriptionChangeType" NOT NULL,
    "stage" "SubscriptionChangeStage" NOT NULL DEFAULT 'REQUESTED',
    "source" "SubscriptionChangeSource" NOT NULL DEFAULT 'SELF_SERVICE',
    "previousPlanId" TEXT,
    "targetPlanId" TEXT,
    "previousBillingPeriod" TEXT,
    "targetBillingPeriod" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "autopayConfigTxHash" TEXT,
    "accessChangeTxHash" TEXT,
    "paymentTxHash" TEXT,
    "autopayControlTxHash" TEXT,
    "recoveryTaskId" TEXT,
    "pendingVerification" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "SubscriptionChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionChangeRequest_teamId_environmentId_companyId_st_idx" ON "SubscriptionChangeRequest"("teamId", "environmentId", "companyId", "stage", "requestedAt");

-- CreateIndex
CREATE INDEX "SubscriptionChangeRequest_teamId_subscriptionStateId_create_idx" ON "SubscriptionChangeRequest"("teamId", "subscriptionStateId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionChangeRequest_companyId_createdAt_idx" ON "SubscriptionChangeRequest"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionChangeRequest_recoveryTaskId_idx" ON "SubscriptionChangeRequest"("recoveryTaskId");

-- CreateIndex
CREATE INDEX "SubscriptionChangeRequest_autopayConfigTxHash_idx" ON "SubscriptionChangeRequest"("autopayConfigTxHash");

-- CreateIndex
CREATE INDEX "SubscriptionChangeRequest_accessChangeTxHash_idx" ON "SubscriptionChangeRequest"("accessChangeTxHash");

-- CreateIndex
CREATE INDEX "SubscriptionChangeRequest_paymentTxHash_idx" ON "SubscriptionChangeRequest"("paymentTxHash");

-- CreateIndex
CREATE INDEX "SubscriptionChangeRequest_autopayControlTxHash_idx" ON "SubscriptionChangeRequest"("autopayControlTxHash");

-- AddForeignKey
ALTER TABLE "SubscriptionChangeRequest" ADD CONSTRAINT "SubscriptionChangeRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChangeRequest" ADD CONSTRAINT "SubscriptionChangeRequest_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChangeRequest" ADD CONSTRAINT "SubscriptionChangeRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChangeRequest" ADD CONSTRAINT "SubscriptionChangeRequest_subscriptionStateId_fkey" FOREIGN KEY ("subscriptionStateId") REFERENCES "SubscriptionState"("id") ON DELETE SET NULL ON UPDATE CASCADE;
