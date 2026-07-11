-- CreateTable
CREATE TABLE "PlatformBillingPlan" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tier" "PlatformTier" NOT NULL,
    "chainId" INTEGER NOT NULL,
    "onChainPlanId" TEXT,
    "planName" TEXT NOT NULL,
    "priceMicros" INTEGER NOT NULL,
    "billingIntervalSeconds" INTEGER NOT NULL,
    "acceptedToken" TEXT NOT NULL,
    "treasuryWallet" TEXT NOT NULL,
    "bootstrapTxHash" TEXT,
    "syncStatus" "ChainSyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncError" TEXT,
    "syncedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "PlatformBillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingPlan_chainId_tier_key" ON "PlatformBillingPlan"("chainId", "tier");

-- CreateIndex
CREATE INDEX "PlatformBillingPlan_syncStatus_idx" ON "PlatformBillingPlan"("syncStatus");
