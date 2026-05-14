-- AlterTable
ALTER TABLE "SchematicCompany" ADD COLUMN "environmentId" TEXT;
ALTER TABLE "SchematicUser" ADD COLUMN "environmentId" TEXT;
ALTER TABLE "SchematicEvent" ADD COLUMN "environmentId" TEXT;

-- Backfill companies from subscription state, then active plan, then first environment.
UPDATE "SchematicCompany" company
SET "environmentId" = subscription."environmentId"
FROM "SubscriptionState" subscription
WHERE subscription."companyId" = company.id
  AND subscription."environmentId" IS NOT NULL
  AND company."environmentId" IS NULL;

UPDATE "SchematicCompany" company
SET "environmentId" = plan."environmentId"
FROM "CatalogPlan" plan
WHERE plan.id = company."activePlanId"
  AND plan."environmentId" IS NOT NULL
  AND company."environmentId" IS NULL;

WITH first_env AS (
  SELECT DISTINCT ON ("teamId") id, "teamId"
  FROM "WorkspaceEnvironment"
  ORDER BY "teamId", "createdAt" ASC
)
UPDATE "SchematicCompany" company
SET "environmentId" = first_env.id
FROM first_env
WHERE company."teamId" = first_env."teamId"
  AND company."environmentId" IS NULL;

UPDATE "SchematicUser" user_row
SET "environmentId" = company."environmentId"
FROM "SchematicCompany" company
WHERE company.id = user_row."companyId"
  AND user_row."environmentId" IS NULL;

UPDATE "SchematicEvent" event_row
SET "environmentId" = company."environmentId"
FROM "SchematicCompany" company
WHERE company.id = event_row."companyId"
  AND event_row."environmentId" IS NULL;

UPDATE "SchematicEvent" event_row
SET "environmentId" = user_row."environmentId"
FROM "SchematicUser" user_row
WHERE user_row.id = event_row."userId"
  AND event_row."environmentId" IS NULL;

WITH first_env AS (
  SELECT DISTINCT ON ("teamId") id, "teamId"
  FROM "WorkspaceEnvironment"
  ORDER BY "teamId", "createdAt" ASC
)
UPDATE "SchematicEvent" event_row
SET "environmentId" = first_env.id
FROM first_env
WHERE event_row."teamId" = first_env."teamId"
  AND event_row."environmentId" IS NULL;

DROP INDEX IF EXISTS "SchematicCompany_teamId_walletAddress_key";
DROP INDEX IF EXISTS "SchematicCompany_teamId_externalId_key";
DROP INDEX IF EXISTS "SchematicUser_teamId_walletAddress_key";
DROP INDEX IF EXISTS "SchematicUser_teamId_clerkUserId_key";

CREATE UNIQUE INDEX "SchematicCompany_teamId_environmentId_walletAddress_key"
  ON "SchematicCompany"("teamId", "environmentId", "walletAddress");
CREATE UNIQUE INDEX "SchematicCompany_teamId_environmentId_externalId_key"
  ON "SchematicCompany"("teamId", "environmentId", "externalId");
CREATE UNIQUE INDEX "SchematicUser_teamId_environmentId_walletAddress_key"
  ON "SchematicUser"("teamId", "environmentId", "walletAddress");
CREATE UNIQUE INDEX "SchematicUser_teamId_environmentId_clerkUserId_key"
  ON "SchematicUser"("teamId", "environmentId", "clerkUserId");

CREATE INDEX "SchematicCompany_teamId_environmentId_email_idx"
  ON "SchematicCompany"("teamId", "environmentId", "email");
CREATE INDEX "SchematicCompany_teamId_environmentId_lastSeenAt_idx"
  ON "SchematicCompany"("teamId", "environmentId", "lastSeenAt");
CREATE INDEX "SchematicUser_teamId_environmentId_companyId_idx"
  ON "SchematicUser"("teamId", "environmentId", "companyId");
CREATE INDEX "SchematicUser_teamId_environmentId_externalId_idx"
  ON "SchematicUser"("teamId", "environmentId", "externalId");
CREATE INDEX "SchematicUser_teamId_environmentId_email_idx"
  ON "SchematicUser"("teamId", "environmentId", "email");
CREATE INDEX "SchematicEvent_teamId_environmentId_name_companyId_sentAt_idx"
  ON "SchematicEvent"("teamId", "environmentId", "name", "companyId", "sentAt");
CREATE INDEX "SchematicEvent_teamId_environmentId_eventType_sentAt_idx"
  ON "SchematicEvent"("teamId", "environmentId", "eventType", "sentAt");
CREATE INDEX "SchematicEvent_teamId_environmentId_companyId_sentAt_idx"
  ON "SchematicEvent"("teamId", "environmentId", "companyId", "sentAt");

ALTER TABLE "SchematicCompany"
  ADD CONSTRAINT "SchematicCompany_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SchematicUser"
  ADD CONSTRAINT "SchematicUser_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SchematicEvent"
  ADD CONSTRAINT "SchematicEvent_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
