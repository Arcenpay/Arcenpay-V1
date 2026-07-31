-- Platform billing plans and provider accounts are environment-scoped.
ALTER TABLE "PlatformBillingPlan"
  ADD COLUMN "environmentId" TEXT;

UPDATE "PlatformBillingPlan" p
SET "environmentId" = a."environmentId"
FROM "PlatformBillingAccount" a
WHERE p."environmentId" IS NULL;

ALTER TABLE "PlatformBillingPlan"
  ALTER COLUMN "environmentId" SET NOT NULL;

ALTER TABLE "PlatformBillingPlan"
  DROP CONSTRAINT IF EXISTS "PlatformBillingPlan_chainId_tier_key";

ALTER TABLE "PlatformBillingPlan"
  ADD CONSTRAINT "PlatformBillingPlan_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PlatformBillingPlan_environmentId_chainId_tier_key"
  ON "PlatformBillingPlan"("environmentId", "chainId", "tier");
CREATE INDEX "PlatformBillingPlan_environmentId_chainId_idx"
  ON "PlatformBillingPlan"("environmentId", "chainId");

ALTER TABLE "PlatformBillingAccount"
  DROP CONSTRAINT IF EXISTS "PlatformBillingAccount_providerTeamId_key";

CREATE UNIQUE INDEX "PlatformBillingAccount_providerTeamId_environmentId_key"
  ON "PlatformBillingAccount"("providerTeamId", "environmentId");
