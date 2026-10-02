CREATE TYPE "SolanaActivationStatus" AS ENUM (
  'INTENT_CREATED', 'SUBMITTED', 'FINALIZED', 'PROVISIONING',
  'ACTIVE', 'FAILED', 'REQUIRES_ATTENTION'
);

CREATE TABLE "SolanaActivationAttempt" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "teamId" TEXT NOT NULL,
  "environmentId" TEXT,
  "companyId" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "status" "SolanaActivationStatus" NOT NULL DEFAULT 'INTENT_CREATED',
  "idempotencyKey" TEXT NOT NULL,
  "txSignature" TEXT,
  "walletAddress" TEXT NOT NULL,
  "catalogPlanId" TEXT NOT NULL,
  "onChainPlanId" TEXT NOT NULL,
  "onChainTokenId" TEXT NOT NULL,
  "expectedAmount" DECIMAL(20,6) NOT NULL,
  "acceptedToken" TEXT NOT NULL,
  "merchantAddress" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3),
  "provisionedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "metadata" JSONB,
  CONSTRAINT "SolanaActivationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SolanaActivationAttempt_idempotencyKey_key" ON "SolanaActivationAttempt"("idempotencyKey");
CREATE UNIQUE INDEX "SolanaActivationAttempt_txSignature_key" ON "SolanaActivationAttempt"("txSignature");
CREATE INDEX "SolanaActivationAttempt_teamId_status_nextAttemptAt_idx" ON "SolanaActivationAttempt"("teamId", "status", "nextAttemptAt");
CREATE INDEX "SolanaActivationAttempt_companyId_createdAt_idx" ON "SolanaActivationAttempt"("companyId", "createdAt");
CREATE INDEX "SolanaActivationAttempt_chainId_txSignature_idx" ON "SolanaActivationAttempt"("chainId", "txSignature");
ALTER TABLE "SolanaActivationAttempt" ADD CONSTRAINT "SolanaActivationAttempt_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SolanaActivationAttempt" ADD CONSTRAINT "SolanaActivationAttempt_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SolanaActivationAttempt" ADD CONSTRAINT "SolanaActivationAttempt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "ArcenCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
