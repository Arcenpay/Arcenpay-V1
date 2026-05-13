-- AlterTable
ALTER TABLE "CatalogPlan" ADD COLUMN     "chainId" INTEGER NOT NULL DEFAULT 84532;

-- AlterTable
ALTER TABLE "SubscriptionState" ADD COLUMN     "chainId" INTEGER NOT NULL DEFAULT 84532;

-- CreateIndex
CREATE INDEX "CatalogPlan_teamId_chainId_onChainPlanId_idx" ON "CatalogPlan"("teamId", "chainId", "onChainPlanId");

-- CreateIndex
CREATE INDEX "SubscriptionState_teamId_chainId_idx" ON "SubscriptionState"("teamId", "chainId");
