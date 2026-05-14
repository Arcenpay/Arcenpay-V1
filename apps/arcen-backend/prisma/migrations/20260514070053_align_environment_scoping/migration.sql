-- DropForeignKey
ALTER TABLE "EmbedAccessToken" DROP CONSTRAINT IF EXISTS "EmbedAccessToken_environmentId_fkey";

-- DropIndex
DROP INDEX "SchematicCompany_teamId_email_idx";

-- DropIndex
DROP INDEX "SchematicCompany_teamId_lastSeenAt_idx";

-- DropIndex
DROP INDEX "SchematicEvent_teamId_companyId_sentAt_idx";

-- DropIndex
DROP INDEX "SchematicEvent_teamId_eventType_sentAt_idx";

-- DropIndex
DROP INDEX "SchematicEvent_teamId_name_companyId_sentAt_idx";

-- DropIndex
DROP INDEX "SchematicUser_teamId_companyId_idx";

-- DropIndex
DROP INDEX "SchematicUser_teamId_email_idx";

-- DropIndex
DROP INDEX "SchematicUser_teamId_externalId_idx";
