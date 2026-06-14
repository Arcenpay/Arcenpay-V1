-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "profileData" JSONB;

-- RenameIndex
ALTER INDEX "CompanyCreditGrant_teamId_environmentId_companyId_creditTypeId_" RENAME TO "CompanyCreditGrant_teamId_environmentId_companyId_creditTyp_idx";

-- RenameIndex
ALTER INDEX "CreditLedgerEntry_teamId_environmentId_companyId_creditTypeId_o" RENAME TO "CreditLedgerEntry_teamId_environmentId_companyId_creditType_idx";
