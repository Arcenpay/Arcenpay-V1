-- First-party platform billing configuration and the mapping from a workspace
-- to its customer identity in the dedicated ArcenPay provider account.
CREATE TABLE "PlatformBillingAccount" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "providerTeamId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "portalComponentId" TEXT,

    CONSTRAINT "PlatformBillingAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformBillingCustomer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceTeamId" TEXT NOT NULL,
    "providerTeamId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "PlatformBillingCustomer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformBillingAccount_providerTeamId_key" ON "PlatformBillingAccount"("providerTeamId");
CREATE UNIQUE INDEX "PlatformBillingAccount_environmentId_key" ON "PlatformBillingAccount"("environmentId");
CREATE UNIQUE INDEX "PlatformBillingAccount_portalComponentId_key" ON "PlatformBillingAccount"("portalComponentId");
CREATE UNIQUE INDEX "PlatformBillingCustomer_workspaceTeamId_key" ON "PlatformBillingCustomer"("workspaceTeamId");
CREATE UNIQUE INDEX "PlatformBillingCustomer_companyId_key" ON "PlatformBillingCustomer"("companyId");
CREATE UNIQUE INDEX "PlatformBillingCustomer_providerTeamId_companyId_key" ON "PlatformBillingCustomer"("providerTeamId", "companyId");
CREATE INDEX "PlatformBillingCustomer_providerTeamId_environmentId_idx" ON "PlatformBillingCustomer"("providerTeamId", "environmentId");

ALTER TABLE "PlatformBillingAccount" ADD CONSTRAINT "PlatformBillingAccount_providerTeamId_fkey"
  FOREIGN KEY ("providerTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformBillingAccount" ADD CONSTRAINT "PlatformBillingAccount_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformBillingAccount" ADD CONSTRAINT "PlatformBillingAccount_portalComponentId_fkey"
  FOREIGN KEY ("portalComponentId") REFERENCES "EmbedComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformBillingCustomer" ADD CONSTRAINT "PlatformBillingCustomer_workspaceTeamId_fkey"
  FOREIGN KEY ("workspaceTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformBillingCustomer" ADD CONSTRAINT "PlatformBillingCustomer_providerTeamId_fkey"
  FOREIGN KEY ("providerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformBillingCustomer" ADD CONSTRAINT "PlatformBillingCustomer_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "WorkspaceEnvironment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformBillingCustomer" ADD CONSTRAINT "PlatformBillingCustomer_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "ArcenCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
