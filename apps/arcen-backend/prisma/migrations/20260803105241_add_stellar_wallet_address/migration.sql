-- DropIndex
DROP INDEX IF EXISTS "CatalogPlan_teamId_chainFamily_chainId_idx";

-- DropIndex
DROP INDEX IF EXISTS "GasSpend_teamId_chainFamily_idx";

-- DropIndex
DROP INDEX IF EXISTS "PlatformBillingPlan_environmentId_chainFamily_chainId_idx";

-- DropIndex
DROP INDEX IF EXISTS "SubscriptionState_teamId_chainFamily_chainId_idx";

-- DropIndex
DROP INDEX IF EXISTS "WorkspaceEnvironment_teamId_chainFamily_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "stellarWalletAddress" TEXT;

-- CreateIndex
CREATE INDEX "User_stellarWalletAddress_idx" ON "User"("stellarWalletAddress");
