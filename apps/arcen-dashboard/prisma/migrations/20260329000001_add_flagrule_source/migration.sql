-- AlterTable
ALTER TABLE "FlagRule" ADD COLUMN "source" TEXT DEFAULT 'manual',
                       ADD COLUMN "sourceId" TEXT;

-- CreateIndex
CREATE INDEX "FlagRule_flagId_source_sourceId_idx" ON "FlagRule"("flagId", "source", "sourceId");
