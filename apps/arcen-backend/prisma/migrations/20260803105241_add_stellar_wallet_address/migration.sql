-- DropIndex
DROP INDEX "CatalogPlan_teamId_chainFamily_chainId_idx";

-- DropIndex
DROP INDEX "GasSpend_teamId_chainFamily_idx";

-- DropIndex
DROP INDEX "PlatformBillingPlan_environmentId_chainFamily_chainId_idx";

-- DropIndex
DROP INDEX "SubscriptionState_teamId_chainFamily_chainId_idx";

-- DropIndex
DROP INDEX "WorkspaceEnvironment_teamId_chainFamily_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "stellarWalletAddress" TEXT;

-- CreateIndex
CREATE INDEX "User_stellarWalletAddress_idx" ON "User"("stellarWalletAddress");
