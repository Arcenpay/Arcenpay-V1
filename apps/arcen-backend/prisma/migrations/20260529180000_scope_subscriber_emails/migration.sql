ALTER TABLE "SubscriberEmail" ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "SubscriberEmail" ADD COLUMN "teamId" TEXT;
ALTER TABLE "SubscriberEmail" ADD COLUMN "environmentId" TEXT;
ALTER TABLE "SubscriberEmail" ADD COLUMN "companyId" TEXT;

DROP INDEX IF EXISTS "SubscriberEmail_walletAddress_key";

CREATE UNIQUE INDEX "SubscriberEmail_scopeKey_walletAddress_key" ON "SubscriberEmail"("scopeKey", "walletAddress");
CREATE INDEX "SubscriberEmail_teamId_environmentId_walletAddress_idx" ON "SubscriberEmail"("teamId", "environmentId", "walletAddress");
CREATE INDEX "SubscriberEmail_companyId_idx" ON "SubscriberEmail"("companyId");
