-- AlterTable
ALTER TABLE "CatalogConfig"
ADD COLUMN "livePlanIds" TEXT[],
ADD COLUMN "liveAddOnIds" TEXT[],
ADD COLUMN "liveCreditTypeIds" TEXT[],
ADD COLUMN "restrictLivePlans" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "restrictLiveAddOns" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "restrictLiveCreditTypes" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CatalogConfig"
SET
  "livePlanIds" = COALESCE("livePlanIds", ARRAY[]::TEXT[]),
  "liveAddOnIds" = COALESCE("liveAddOnIds", ARRAY[]::TEXT[]),
  "liveCreditTypeIds" = COALESCE("liveCreditTypeIds", ARRAY[]::TEXT[]);
