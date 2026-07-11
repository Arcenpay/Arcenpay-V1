-- AlterTable
ALTER TABLE "ArcenApiKey" RENAME CONSTRAINT "SchematicApiKey_pkey" TO "ArcenApiKey_pkey";

-- AlterTable
ALTER TABLE "ArcenCompany" RENAME CONSTRAINT "SchematicCompany_pkey" TO "ArcenCompany_pkey";

-- AlterTable
ALTER TABLE "ArcenEvent" RENAME CONSTRAINT "SchematicEvent_pkey" TO "ArcenEvent_pkey";

-- AlterTable
ALTER TABLE "ArcenUser" RENAME CONSTRAINT "SchematicUser_pkey" TO "ArcenUser_pkey";

-- RenameForeignKey
ALTER TABLE "ArcenApiKey" RENAME CONSTRAINT "SchematicApiKey_environmentId_fkey" TO "ArcenApiKey_environmentId_fkey";

-- RenameForeignKey
ALTER TABLE "ArcenApiKey" RENAME CONSTRAINT "SchematicApiKey_teamId_fkey" TO "ArcenApiKey_teamId_fkey";

-- RenameForeignKey
ALTER TABLE "ArcenCompany" RENAME CONSTRAINT "SchematicCompany_environmentId_fkey" TO "ArcenCompany_environmentId_fkey";

-- RenameForeignKey
ALTER TABLE "ArcenCompany" RENAME CONSTRAINT "SchematicCompany_teamId_fkey" TO "ArcenCompany_teamId_fkey";

-- RenameForeignKey
ALTER TABLE "ArcenEvent" RENAME CONSTRAINT "SchematicEvent_companyId_fkey" TO "ArcenEvent_companyId_fkey";

-- RenameForeignKey
ALTER TABLE "ArcenEvent" RENAME CONSTRAINT "SchematicEvent_environmentId_fkey" TO "ArcenEvent_environmentId_fkey";

-- RenameForeignKey
ALTER TABLE "ArcenUser" RENAME CONSTRAINT "SchematicUser_companyId_fkey" TO "ArcenUser_companyId_fkey";

-- RenameForeignKey
ALTER TABLE "ArcenUser" RENAME CONSTRAINT "SchematicUser_environmentId_fkey" TO "ArcenUser_environmentId_fkey";

-- RenameIndex
ALTER INDEX "SchematicApiKey_keyHash_key" RENAME TO "ArcenApiKey_keyHash_key";

-- RenameIndex
ALTER INDEX "SchematicApiKey_teamId_environmentId_idx" RENAME TO "ArcenApiKey_teamId_environmentId_idx";

-- RenameIndex
ALTER INDEX "SchematicApiKey_teamId_idx" RENAME TO "ArcenApiKey_teamId_idx";

-- RenameIndex
ALTER INDEX "SchematicCompany_teamId_environmentId_email_idx" RENAME TO "ArcenCompany_teamId_environmentId_email_idx";

-- RenameIndex
ALTER INDEX "SchematicCompany_teamId_environmentId_externalId_key" RENAME TO "ArcenCompany_teamId_environmentId_externalId_key";

-- RenameIndex
ALTER INDEX "SchematicCompany_teamId_environmentId_lastSeenAt_idx" RENAME TO "ArcenCompany_teamId_environmentId_lastSeenAt_idx";

-- RenameIndex
ALTER INDEX "SchematicCompany_teamId_environmentId_walletAddress_key" RENAME TO "ArcenCompany_teamId_environmentId_walletAddress_key";

-- RenameIndex
ALTER INDEX "SchematicEvent_teamId_environmentId_companyId_sentAt_idx" RENAME TO "ArcenEvent_teamId_environmentId_companyId_sentAt_idx";

-- RenameIndex
ALTER INDEX "SchematicEvent_teamId_environmentId_eventType_sentAt_idx" RENAME TO "ArcenEvent_teamId_environmentId_eventType_sentAt_idx";

-- RenameIndex
ALTER INDEX "SchematicEvent_teamId_environmentId_name_companyId_sentAt_idx" RENAME TO "ArcenEvent_teamId_environmentId_name_companyId_sentAt_idx";

-- RenameIndex
ALTER INDEX "SchematicUser_teamId_environmentId_clerkUserId_key" RENAME TO "ArcenUser_teamId_environmentId_clerkUserId_key";

-- RenameIndex
ALTER INDEX "SchematicUser_teamId_environmentId_companyId_idx" RENAME TO "ArcenUser_teamId_environmentId_companyId_idx";

-- RenameIndex
ALTER INDEX "SchematicUser_teamId_environmentId_email_idx" RENAME TO "ArcenUser_teamId_environmentId_email_idx";

-- RenameIndex
ALTER INDEX "SchematicUser_teamId_environmentId_externalId_idx" RENAME TO "ArcenUser_teamId_environmentId_externalId_idx";

-- RenameIndex
ALTER INDEX "SchematicUser_teamId_environmentId_walletAddress_key" RENAME TO "ArcenUser_teamId_environmentId_walletAddress_key";
