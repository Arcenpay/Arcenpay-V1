CREATE TABLE IF NOT EXISTS "CatalogCoupon" (
    "teamId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "discountPercent" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "applicablePlanId" TEXT,
    "billingPeriod" TEXT,
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogCoupon_pkey" PRIMARY KEY ("teamId","code"),
    CONSTRAINT "CatalogCoupon_discountPercent_check" CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100),
    CONSTRAINT "CatalogCoupon_maxRedemptions_check" CHECK ("maxRedemptions" IS NULL OR "maxRedemptions" >= 0),
    CONSTRAINT "CatalogCoupon_redemptionCount_check" CHECK ("redemptionCount" >= 0)
);

CREATE INDEX IF NOT EXISTS "CatalogCoupon_teamId_active_idx" ON "CatalogCoupon"("teamId", "active");
CREATE INDEX IF NOT EXISTS "CatalogCoupon_teamId_applicablePlanId_idx" ON "CatalogCoupon"("teamId", "applicablePlanId");
