-- Add chainId to Payment so payment rows record which chain they occurred on
-- (EVM real ids like 84532, Stellar synthetic ids 9_000_000+). chainFamily is
-- already present; chainId complements it for explorer links + chain-scoped
-- queries. Nullable so existing rows need no backfill.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "chainId" INTEGER;

-- CreateIndex
CREATE INDEX "Payment_teamId_chainId_status_idx" ON "Payment"("teamId", "chainId", "status");
