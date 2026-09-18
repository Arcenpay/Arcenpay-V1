-- CreateEnum
CREATE TYPE "ApiKeyType" AS ENUM ('SECRET', 'PUBLISHABLE', 'RESTRICTED');

-- AlterTable
ALTER TABLE "ArcenApiKey" ADD COLUMN     "environmentMode" "EnvironmentMode" NOT NULL DEFAULT 'DEVELOPMENT',
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "type" "ApiKeyType" NOT NULL DEFAULT 'SECRET';
