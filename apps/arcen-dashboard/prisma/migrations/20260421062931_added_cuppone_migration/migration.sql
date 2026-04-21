-- AlterTable
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'CatalogCoupon'
    ) THEN
        EXECUTE 'ALTER TABLE "CatalogCoupon" ALTER COLUMN "updatedAt" DROP DEFAULT';
    END IF;
END $$;

-- AlterTable
ALTER TABLE "CatalogCreditType" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "CatalogPlan" ADD COLUMN     "annualPrice" DECIMAL(20,6);
