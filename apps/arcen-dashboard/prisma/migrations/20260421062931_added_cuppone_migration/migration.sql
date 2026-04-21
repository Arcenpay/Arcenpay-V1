-- AlterTable
ALTER TABLE "CatalogCoupon" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CatalogCreditType" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "CatalogPlan" ADD COLUMN     "annualPrice" DECIMAL(20,6);
