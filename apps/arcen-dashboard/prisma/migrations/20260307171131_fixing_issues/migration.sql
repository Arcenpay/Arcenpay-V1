-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'FINANCE', 'DEVELOPER', 'SUPPORT', 'MEMBER');

-- CreateEnum
CREATE TYPE "EnvironmentMode" AS ENUM ('DEVELOPMENT', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "CatalogEntityType" AS ENUM ('PLAN', 'ADDON', 'CREDIT');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AddOnBillingType" AS ENUM ('ONE_TIME', 'RECURRING');

-- CreateEnum
CREATE TYPE "TemplateInstallStatus" AS ENUM ('INSTALLED', 'UNINSTALLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "InvoiceDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingEventType" AS ENUM ('SUBSCRIPTION_MINTED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_CANCELLED', 'PAYMENT_FAILED', 'CREDIT_ISSUED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'API', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "walletAddress" TEXT,
    "clerkUserId" TEXT,
    "currentTeamId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicToken" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "MagicToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "environmentMode" "EnvironmentMode" NOT NULL DEFAULT 'DEVELOPMENT',
    "invoicePrefix" TEXT,
    "clerkOrgId" TEXT,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderProfile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyWebhook" BOOLEAN NOT NULL DEFAULT false,
    "webhookUrl" TEXT,
    "webhookSigningSecret" TEXT,
    "apiKeyHash" TEXT,
    "apiKeyPrefix" TEXT,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "ProviderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriberEmail" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "planId" TEXT,

    CONSTRAINT "SubscriberEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "nonce" TEXT NOT NULL,
    "issuedAt" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "CatalogPlan" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "environmentMode" "EnvironmentMode" NOT NULL DEFAULT 'DEVELOPMENT',
    "status" "CatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(20,6) NOT NULL,
    "billingInterval" INTEGER NOT NULL,
    "acceptedToken" TEXT NOT NULL,
    "metadata" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "onChainPlanId" TEXT,

    CONSTRAINT "CatalogPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogAddOn" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "environmentMode" "EnvironmentMode" NOT NULL DEFAULT 'DEVELOPMENT',
    "status" "CatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "billingType" "AddOnBillingType" NOT NULL DEFAULT 'ONE_TIME',
    "price" DECIMAL(20,6) NOT NULL,
    "acceptedToken" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogCreditType" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "environmentMode" "EnvironmentMode" NOT NULL DEFAULT 'DEVELOPMENT',
    "status" "CatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unitName" TEXT NOT NULL,
    "unitsPerPack" INTEGER NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,
    "acceptedToken" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogCreditType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "teamId" TEXT NOT NULL,
    "environmentMode" "EnvironmentMode" NOT NULL DEFAULT 'DEVELOPMENT',
    "entityType" "CatalogEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "CatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingTemplate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "CatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BillingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingTemplateVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "reactBlocks" JSONB NOT NULL,
    "styleTokens" JSONB NOT NULL,
    "compatibility" JSONB NOT NULL,

    CONSTRAINT "BillingTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateInstall" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "installedVersion" INTEGER NOT NULL,
    "environmentMode" "EnvironmentMode" NOT NULL DEFAULT 'DEVELOPMENT',
    "chainId" INTEGER NOT NULL,
    "status" "TemplateInstallStatus" NOT NULL DEFAULT 'INSTALLED',

    CONSTRAINT "TemplateInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxProfile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "taxId" TEXT,
    "gstin" TEXT,
    "addressJson" JSONB NOT NULL,
    "taxRegime" TEXT NOT NULL,

    CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "environmentMode" "EnvironmentMode" NOT NULL DEFAULT 'DEVELOPMENT',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "customerEmail" TEXT,
    "customerWallet" TEXT,
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "planId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(20,6) NOT NULL,
    "taxRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "lineSubtotal" DECIMAL(20,6) NOT NULL,
    "lineTax" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(20,6) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceDelivery" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "method" TEXT NOT NULL DEFAULT 'email',
    "status" "InvoiceDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "externalMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "InvoiceDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT NOT NULL,
    "noteNumber" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorAddress" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "requestId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "metadata" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "eventType" "BillingEventType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'facilitator',
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER,
    "attemptNumber" INTEGER NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "payload" JSONB,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_walletAddress_idx" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "User_clerkUserId_idx" ON "User"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MagicToken_token_key" ON "MagicToken"("token");

-- CreateIndex
CREATE INDEX "MagicToken_token_idx" ON "MagicToken"("token");

-- CreateIndex
CREATE INDEX "MagicToken_email_idx" ON "MagicToken"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Team_clerkOrgId_key" ON "Team"("clerkOrgId");

-- CreateIndex
CREATE INDEX "Team_slug_idx" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "Team_clerkOrgId_idx" ON "Team"("clerkOrgId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_userId_teamId_key" ON "TeamMember"("userId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_apiKeyHash_key" ON "ProviderProfile"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_teamId_key" ON "ProviderProfile"("teamId");

-- CreateIndex
CREATE INDEX "ProviderProfile_teamId_idx" ON "ProviderProfile"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriberEmail_walletAddress_key" ON "SubscriberEmail"("walletAddress");

-- CreateIndex
CREATE INDEX "SubscriberEmail_walletAddress_idx" ON "SubscriberEmail"("walletAddress");

-- CreateIndex
CREATE INDEX "SubscriberEmail_email_idx" ON "SubscriberEmail"("email");

-- CreateIndex
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");

-- CreateIndex
CREATE INDEX "CatalogPlan_teamId_environmentMode_status_idx" ON "CatalogPlan"("teamId", "environmentMode", "status");

-- CreateIndex
CREATE INDEX "CatalogPlan_teamId_name_idx" ON "CatalogPlan"("teamId", "name");

-- CreateIndex
CREATE INDEX "CatalogAddOn_teamId_environmentMode_status_idx" ON "CatalogAddOn"("teamId", "environmentMode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogAddOn_teamId_code_environmentMode_key" ON "CatalogAddOn"("teamId", "code", "environmentMode");

-- CreateIndex
CREATE INDEX "CatalogCreditType_teamId_environmentMode_status_idx" ON "CatalogCreditType"("teamId", "environmentMode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCreditType_teamId_code_environmentMode_key" ON "CatalogCreditType"("teamId", "code", "environmentMode");

-- CreateIndex
CREATE INDEX "CatalogVersion_teamId_environmentMode_status_idx" ON "CatalogVersion"("teamId", "environmentMode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogVersion_teamId_entityType_entityId_version_key" ON "CatalogVersion"("teamId", "entityType", "entityId", "version");

-- CreateIndex
CREATE INDEX "BillingTemplate_teamId_status_idx" ON "BillingTemplate"("teamId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingTemplate_teamId_slug_key" ON "BillingTemplate"("teamId", "slug");

-- CreateIndex
CREATE INDEX "BillingTemplateVersion_templateId_idx" ON "BillingTemplateVersion"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingTemplateVersion_templateId_version_key" ON "BillingTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "TemplateInstall_teamId_environmentMode_status_idx" ON "TemplateInstall"("teamId", "environmentMode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateInstall_teamId_templateId_environmentMode_chainId_key" ON "TemplateInstall"("teamId", "templateId", "environmentMode", "chainId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxProfile_teamId_key" ON "TaxProfile"("teamId");

-- CreateIndex
CREATE INDEX "InvoiceSequence_teamId_idx" ON "InvoiceSequence"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSequence_teamId_year_key" ON "InvoiceSequence"("teamId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_teamId_status_issuedAt_idx" ON "Invoice"("teamId", "status", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_teamId_environmentMode_idx" ON "Invoice"("teamId", "environmentMode");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceDelivery_invoiceId_status_idx" ON "InvoiceDelivery"("invoiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_noteNumber_key" ON "CreditNote"("noteNumber");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "AuditEvent_teamId_createdAt_idx" ON "AuditEvent"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_teamId_action_idx" ON "AuditEvent"("teamId", "action");

-- CreateIndex
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_idempotencyKey_key" ON "BillingEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingEvent_teamId_createdAt_idx" ON "BillingEvent"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingEvent_teamId_processed_idx" ON "BillingEvent"("teamId", "processed");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_deliveryId_key" ON "WebhookDelivery"("deliveryId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_teamId_deliveredAt_idx" ON "WebhookDelivery"("teamId", "deliveredAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_teamId_success_idx" ON "WebhookDelivery"("teamId", "success");

-- AddForeignKey
ALTER TABLE "MagicToken" ADD CONSTRAINT "MagicToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPlan" ADD CONSTRAINT "CatalogPlan_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogAddOn" ADD CONSTRAINT "CatalogAddOn_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogCreditType" ADD CONSTRAINT "CatalogCreditType_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogVersion" ADD CONSTRAINT "CatalogVersion_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingTemplate" ADD CONSTRAINT "BillingTemplate_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingTemplateVersion" ADD CONSTRAINT "BillingTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "BillingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateInstall" ADD CONSTRAINT "TemplateInstall_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateInstall" ADD CONSTRAINT "TemplateInstall_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "BillingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDelivery" ADD CONSTRAINT "InvoiceDelivery_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
