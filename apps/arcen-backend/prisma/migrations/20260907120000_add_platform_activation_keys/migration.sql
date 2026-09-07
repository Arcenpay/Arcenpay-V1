-- CreateEnum
CREATE TYPE "ActivationKeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'EXHAUSTED');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN "isPlatformActivated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "activationKeyId" TEXT,
ADD COLUMN "allowPlatformBilling" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PlatformActivationKey" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "recipientName" TEXT,
    "tier" "PlatformTier" NOT NULL DEFAULT 'PRO',
    "allowPlatformBilling" BOOLEAN NOT NULL DEFAULT false,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ActivationKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdById" TEXT,
    "notes" TEXT,
    "metadata" JSONB,

    CONSTRAINT "PlatformActivationKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformActivationRedemption" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activationKeyId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "walletAddress" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "PlatformActivationRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformActivationKey_key_key" ON "PlatformActivationKey"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformActivationKey_keyHash_key" ON "PlatformActivationKey"("keyHash");

-- CreateIndex
CREATE INDEX "PlatformActivationKey_status_idx" ON "PlatformActivationKey"("status");

-- CreateIndex
CREATE INDEX "PlatformActivationKey_keyHash_idx" ON "PlatformActivationKey"("keyHash");

-- CreateIndex
CREATE INDEX "PlatformActivationKey_tier_idx" ON "PlatformActivationKey"("tier");

-- CreateIndex
CREATE INDEX "PlatformActivationKey_createdAt_idx" ON "PlatformActivationKey"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformActivationRedemption_activationKeyId_idx" ON "PlatformActivationRedemption"("activationKeyId");

-- CreateIndex
CREATE INDEX "PlatformActivationRedemption_teamId_idx" ON "PlatformActivationRedemption"("teamId");

-- CreateIndex
CREATE INDEX "PlatformActivationRedemption_createdAt_idx" ON "PlatformActivationRedemption"("createdAt");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_activationKeyId_fkey" FOREIGN KEY ("activationKeyId") REFERENCES "PlatformActivationKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformActivationRedemption" ADD CONSTRAINT "PlatformActivationRedemption_activationKeyId_fkey" FOREIGN KEY ("activationKeyId") REFERENCES "PlatformActivationKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformActivationRedemption" ADD CONSTRAINT "PlatformActivationRedemption_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
