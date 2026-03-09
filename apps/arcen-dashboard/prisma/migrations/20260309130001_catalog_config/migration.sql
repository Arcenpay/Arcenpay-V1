-- CreateTable
CREATE TABLE "CatalogConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "environmentMode" "EnvironmentMode" NOT NULL DEFAULT 'DEVELOPMENT',
    "initialPlan" TEXT NOT NULL DEFAULT 'Free',
    "fallbackPlan" TEXT,
    "showBillingPeriodToggle" BOOLEAN NOT NULL DEFAULT true,
    "freePlanPriceDisplay" BOOLEAN NOT NULL DEFAULT true,
    "hideCredits" BOOLEAN NOT NULL DEFAULT false,
    "yearlyDiscountDisplay" BOOLEAN NOT NULL DEFAULT true,
    "showFeatureDescriptions" BOOLEAN NOT NULL DEFAULT true,
    "showHardLimits" BOOLEAN NOT NULL DEFAULT true,
    "upgradeImmediately" BOOLEAN NOT NULL DEFAULT true,
    "downgradeImmediately" BOOLEAN NOT NULL DEFAULT false,
    "preventDowngradeOverLimit" BOOLEAN NOT NULL DEFAULT true,
    "disallowSelfServiceDowngrade" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CatalogConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogConfig_teamId_environmentMode_key" ON "CatalogConfig"("teamId", "environmentMode");

-- CreateIndex
CREATE INDEX "CatalogConfig_teamId_environmentMode_idx" ON "CatalogConfig"("teamId", "environmentMode");

-- AddForeignKey
ALTER TABLE "CatalogConfig" ADD CONSTRAINT "CatalogConfig_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
