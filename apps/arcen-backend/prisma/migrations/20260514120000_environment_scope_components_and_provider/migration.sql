-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN "environmentId" TEXT;
ALTER TABLE "EmbedAccessToken" ADD COLUMN "environmentId" TEXT;
ALTER TABLE "SchematicApiKey" ADD COLUMN "environmentId" TEXT;
ALTER TABLE "EmbedComponent" ADD COLUMN "environmentId" TEXT;

WITH first_env AS (
  SELECT DISTINCT ON ("teamId") id, "teamId"
  FROM "WorkspaceEnvironment"
  ORDER BY "teamId", "createdAt" ASC
)
UPDATE "ProviderProfile" profile
SET "environmentId" = first_env.id
FROM first_env
WHERE profile."teamId" = first_env."teamId"
  AND profile."environmentId" IS NULL;

WITH first_env AS (
  SELECT DISTINCT ON ("teamId") id, "teamId"
  FROM "WorkspaceEnvironment"
  ORDER BY "teamId", "createdAt" ASC
)
UPDATE "SchematicApiKey" api_key
SET "environmentId" = first_env.id
FROM first_env
WHERE api_key."teamId" = first_env."teamId"
  AND api_key."environmentId" IS NULL;

WITH first_env AS (
  SELECT DISTINCT ON ("teamId") id, "teamId"
  FROM "WorkspaceEnvironment"
  ORDER BY "teamId", "createdAt" ASC
)
UPDATE "EmbedComponent" component
SET "environmentId" = first_env.id
FROM first_env
WHERE component."teamId" = first_env."teamId"
  AND component."environmentId" IS NULL;

WITH first_env AS (
  SELECT DISTINCT ON ("teamId") id, "teamId"
  FROM "WorkspaceEnvironment"
  ORDER BY "teamId", "createdAt" ASC
)
UPDATE "EmbedAccessToken" token
SET "environmentId" = first_env.id
FROM first_env
WHERE token."teamId" = first_env."teamId"
  AND token."environmentId" IS NULL;

DROP INDEX IF EXISTS "ProviderProfile_teamId_key";
CREATE UNIQUE INDEX "ProviderProfile_teamId_environmentId_key"
  ON "ProviderProfile"("teamId", "environmentId");

CREATE INDEX "ProviderProfile_teamId_environmentId_idx"
  ON "ProviderProfile"("teamId", "environmentId");
CREATE INDEX "EmbedAccessToken_teamId_environmentId_idx"
  ON "EmbedAccessToken"("teamId", "environmentId");
CREATE INDEX "SchematicApiKey_teamId_environmentId_idx"
  ON "SchematicApiKey"("teamId", "environmentId");
CREATE INDEX "EmbedComponent_teamId_environmentId_idx"
  ON "EmbedComponent"("teamId", "environmentId");

ALTER TABLE "ProviderProfile"
  ADD CONSTRAINT "ProviderProfile_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SchematicApiKey"
  ADD CONSTRAINT "SchematicApiKey_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmbedComponent"
  ADD CONSTRAINT "EmbedComponent_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmbedAccessToken"
  ADD CONSTRAINT "EmbedAccessToken_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
