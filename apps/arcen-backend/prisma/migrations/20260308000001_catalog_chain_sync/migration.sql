-- Add ChainSyncStatus enum
CREATE TYPE "ChainSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'NOT_APPLICABLE');

-- Add chain sync fields to CatalogPlan
ALTER TABLE "CatalogPlan"
  ADD COLUMN "chainSyncStatus" "ChainSyncStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN "chainTxHash"     TEXT,
  ADD COLUMN "chainSyncError"  TEXT,
  ADD COLUMN "chainSyncedAt"   TIMESTAMP(3);

-- Add chain sync fields to CatalogAddOn
ALTER TABLE "CatalogAddOn"
  ADD COLUMN "chainSyncStatus" "ChainSyncStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN "chainTxHash"     TEXT,
  ADD COLUMN "chainSyncError"  TEXT,
  ADD COLUMN "chainSyncedAt"   TIMESTAMP(3);

-- Add chain sync fields to CatalogCreditType
ALTER TABLE "CatalogCreditType"
  ADD COLUMN "chainSyncStatus" "ChainSyncStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN "chainTxHash"     TEXT,
  ADD COLUMN "chainSyncError"  TEXT,
  ADD COLUMN "chainSyncedAt"   TIMESTAMP(3);

-- Add per-event notification preferences to ProviderProfile
ALTER TABLE "ProviderProfile"
  ADD COLUMN "notificationPreferences" JSONB;
