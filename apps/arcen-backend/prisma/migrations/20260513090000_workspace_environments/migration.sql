-- AlterTable
ALTER TABLE "AuthSession"
ADD COLUMN "activeEnvironmentId" TEXT;

ALTER TABLE "CatalogPlan"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "CatalogAddOn"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "CatalogCreditType"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "CatalogVersion"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "CatalogConfig"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "TemplateInstall"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "Invoice"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "SubscriptionState"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "Payment"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "PaymentLink"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "CheckoutSession"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "PlatformTierConfig"
ADD COLUMN "maxDevelopmentEnvironments" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "maxProductionEnvironments" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "WorkspaceEnvironment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "EnvironmentMode" NOT NULL,
    "chainId" INTEGER NOT NULL,

    CONSTRAINT "WorkspaceEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthSession_activeEnvironmentId_idx" ON "AuthSession"("activeEnvironmentId");

CREATE INDEX "CatalogPlan_teamId_environmentId_status_idx" ON "CatalogPlan"("teamId", "environmentId", "status");
CREATE INDEX "CatalogAddOn_teamId_environmentId_status_idx" ON "CatalogAddOn"("teamId", "environmentId", "status");
CREATE INDEX "CatalogCreditType_teamId_environmentId_status_idx" ON "CatalogCreditType"("teamId", "environmentId", "status");
CREATE INDEX "CatalogVersion_teamId_environmentId_status_idx" ON "CatalogVersion"("teamId", "environmentId", "status");
CREATE UNIQUE INDEX "CatalogConfig_environmentId_key" ON "CatalogConfig"("environmentId");
CREATE INDEX "CatalogConfig_teamId_environmentId_idx" ON "CatalogConfig"("teamId", "environmentId");
CREATE INDEX "TemplateInstall_teamId_environmentId_status_idx" ON "TemplateInstall"("teamId", "environmentId", "status");
CREATE INDEX "Invoice_teamId_environmentId_idx" ON "Invoice"("teamId", "environmentId");
CREATE INDEX "SubscriptionState_teamId_environmentId_idx" ON "SubscriptionState"("teamId", "environmentId");
CREATE INDEX "Payment_teamId_environmentId_idx" ON "Payment"("teamId", "environmentId");
CREATE INDEX "PaymentLink_teamId_environmentId_status_idx" ON "PaymentLink"("teamId", "environmentId", "status");
CREATE INDEX "CheckoutSession_teamId_environmentId_status_idx" ON "CheckoutSession"("teamId", "environmentId", "status");

CREATE UNIQUE INDEX "WorkspaceEnvironment_teamId_name_key" ON "WorkspaceEnvironment"("teamId", "name");
CREATE INDEX "WorkspaceEnvironment_teamId_mode_idx" ON "WorkspaceEnvironment"("teamId", "mode");
CREATE INDEX "WorkspaceEnvironment_teamId_chainId_idx" ON "WorkspaceEnvironment"("teamId", "chainId");

-- AddForeignKey
ALTER TABLE "AuthSession"
ADD CONSTRAINT "AuthSession_activeEnvironmentId_fkey"
FOREIGN KEY ("activeEnvironmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkspaceEnvironment"
ADD CONSTRAINT "WorkspaceEnvironment_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogPlan"
ADD CONSTRAINT "CatalogPlan_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogAddOn"
ADD CONSTRAINT "CatalogAddOn_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogCreditType"
ADD CONSTRAINT "CatalogCreditType_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogVersion"
ADD CONSTRAINT "CatalogVersion_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogConfig"
ADD CONSTRAINT "CatalogConfig_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TemplateInstall"
ADD CONSTRAINT "TemplateInstall_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubscriptionState"
ADD CONSTRAINT "SubscriptionState_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentLink"
ADD CONSTRAINT "PaymentLink_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CheckoutSession"
ADD CONSTRAINT "CheckoutSession_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
