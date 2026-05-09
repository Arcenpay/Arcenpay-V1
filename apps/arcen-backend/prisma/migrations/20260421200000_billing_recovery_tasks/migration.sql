-- CreateEnum
CREATE TYPE "BillingRecoveryTaskKind" AS ENUM (
  'SUBSCRIPTION_ACTIVATION'
);

-- CreateEnum
CREATE TYPE "BillingRecoveryTaskStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

-- CreateTable
CREATE TABLE "BillingRecoveryTask" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "teamId" TEXT NOT NULL,
  "companyId" TEXT,
  "kind" "BillingRecoveryTaskKind" NOT NULL,
  "status" "BillingRecoveryTaskStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "txHash" TEXT,
  "walletAddress" TEXT,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,

  CONSTRAINT "BillingRecoveryTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingRecoveryTask_idempotencyKey_key" ON "BillingRecoveryTask"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillingRecoveryTask_txHash_key" ON "BillingRecoveryTask"("txHash");

-- CreateIndex
CREATE INDEX "BillingRecoveryTask_teamId_status_nextAttemptAt_createdAt_idx" ON "BillingRecoveryTask"("teamId", "status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "BillingRecoveryTask_companyId_createdAt_idx" ON "BillingRecoveryTask"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingRecoveryTask_walletAddress_createdAt_idx" ON "BillingRecoveryTask"("walletAddress", "createdAt");

-- AddForeignKey
ALTER TABLE "BillingRecoveryTask" ADD CONSTRAINT "BillingRecoveryTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRecoveryTask" ADD CONSTRAINT "BillingRecoveryTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
