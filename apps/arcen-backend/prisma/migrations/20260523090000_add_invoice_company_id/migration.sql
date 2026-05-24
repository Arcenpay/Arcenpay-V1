ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "companyId" TEXT;

CREATE INDEX IF NOT EXISTS "Invoice_companyId_idx" ON "Invoice"("companyId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Invoice_companyId_fkey'
  ) THEN
    ALTER TABLE "Invoice"
      ADD CONSTRAINT "Invoice_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
