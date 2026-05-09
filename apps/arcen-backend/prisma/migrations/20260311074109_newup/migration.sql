-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "PlatformTier" AS ENUM ('FREE', 'PLUS', 'PRO');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "platformTier" "PlatformTier" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "tierExpiresAt" TIMESTAMP(3),
ADD COLUMN     "tierSubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "PlatformTierConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tier" "PlatformTier" NOT NULL,
    "maxWorkspaces" INTEGER NOT NULL DEFAULT 1,
    "maxPlans" INTEGER NOT NULL DEFAULT 1,
    "maxSubscribers" INTEGER NOT NULL DEFAULT 100,
    "maxTeamMembers" INTEGER NOT NULL DEFAULT 1,
    "maxFeatureFlags" INTEGER NOT NULL DEFAULT 3,
    "maxChains" INTEGER NOT NULL DEFAULT 1,
    "platformFeeBps" INTEGER NOT NULL DEFAULT 200,
    "gasSponsored" BOOLEAN NOT NULL DEFAULT true,
    "gasDailyBudgetUsd" DECIMAL(10,2) NOT NULL DEFAULT 0.50,

    CONSTRAINT "PlatformTierConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GasSpend" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "gasUsedWei" TEXT NOT NULL,
    "gasCostUsd" DECIMAL(20,8) NOT NULL,
    "walletAddress" TEXT,

    CONSTRAINT "GasSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierUpgradeHistory" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "fromTier" "PlatformTier" NOT NULL,
    "toTier" "PlatformTier" NOT NULL,
    "txHash" TEXT,
    "amountUsd" DECIMAL(10,2),
    "userId" TEXT NOT NULL,

    CONSTRAINT "TierUpgradeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
    "category" TEXT,
    "assignee" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformTierConfig_tier_key" ON "PlatformTierConfig"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "GasSpend_txHash_key" ON "GasSpend"("txHash");

-- CreateIndex
CREATE INDEX "GasSpend_teamId_createdAt_idx" ON "GasSpend"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "GasSpend_teamId_walletAddress_createdAt_idx" ON "GasSpend"("teamId", "walletAddress", "createdAt");

-- CreateIndex
CREATE INDEX "TierUpgradeHistory_teamId_createdAt_idx" ON "TierUpgradeHistory"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_teamId_status_idx" ON "SupportTicket"("teamId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_teamId_createdAt_idx" ON "SupportTicket"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_priority_idx" ON "SupportTicket"("status", "priority");

-- CreateIndex
CREATE INDEX "Team_platformTier_idx" ON "Team"("platformTier");

-- AddForeignKey
ALTER TABLE "GasSpend" ADD CONSTRAINT "GasSpend_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierUpgradeHistory" ADD CONSTRAINT "TierUpgradeHistory_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
