-- GA foundation migration: catalog, templates, invoices, audit, durable events

-- Extend TeamRole enum for production RBAC
DO $$ BEGIN
  ALTER TYPE "TeamRole" ADD VALUE IF NOT EXISTS 'FINANCE';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "TeamRole" ADD VALUE IF NOT EXISTS 'DEVELOPER';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "TeamRole" ADD VALUE IF NOT EXISTS 'SUPPORT';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- New enums
CREATE TYPE "EnvironmentMode" AS ENUM ('DEVELOPMENT', 'PRODUCTION');
CREATE TYPE "CatalogEntityType" AS ENUM ('PLAN', 'ADDON', 'CREDIT');
CREATE TYPE "CatalogStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "AddOnBillingType" AS ENUM ('ONE_TIME', 'RECURRING');
CREATE TYPE "TemplateInstallStatus" AS ENUM ('INSTALLED', 'UNINSTALLED');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID', 'OVERDUE');
CREATE TYPE "InvoiceDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TYPE "BillingEventType" AS ENUM (
  'SUBSCRIPTION_MINTED',
  'SUBSCRIPTION_RENEWED',
  'SUBSCRIPTION_CANCELLED',
  'PAYMENT_FAILED',
  'CREDIT_ISSUED'
);
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'API', 'SYSTEM');

-- Existing tables update
ALTER TABLE "Team"
  ADD COLUMN "environmentMode" "EnvironmentMode" NOT NULL DEFAULT 'DEVELOPMENT',
  ADD COLUMN "invoicePrefix" TEXT;

ALTER TABLE "ProviderProfile"
  ADD COLUMN "webhookSigningSecret" TEXT;

-- Catalog
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

-- Templates
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

-- Invoice domain
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

CREATE TABLE "InvoiceSequence" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "teamId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("id")
);

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

-- Audit / durable events
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

-- Indexes and uniques
CREATE INDEX "CatalogPlan_team_env_status_idx" ON "CatalogPlan"("teamId", "environmentMode", "status");
CREATE INDEX "CatalogPlan_team_name_idx" ON "CatalogPlan"("teamId", "name");
CREATE INDEX "CatalogAddOn_team_env_status_idx" ON "CatalogAddOn"("teamId", "environmentMode", "status");
CREATE UNIQUE INDEX "CatalogAddOn_team_code_env_key" ON "CatalogAddOn"("teamId", "code", "environmentMode");
CREATE INDEX "CatalogCreditType_team_env_status_idx" ON "CatalogCreditType"("teamId", "environmentMode", "status");
CREATE UNIQUE INDEX "CatalogCreditType_team_code_env_key" ON "CatalogCreditType"("teamId", "code", "environmentMode");
CREATE INDEX "CatalogVersion_team_env_status_idx" ON "CatalogVersion"("teamId", "environmentMode", "status");
CREATE UNIQUE INDEX "CatalogVersion_team_entity_entityId_version_key" ON "CatalogVersion"("teamId", "entityType", "entityId", "version");

CREATE INDEX "BillingTemplate_team_status_idx" ON "BillingTemplate"("teamId", "status");
CREATE UNIQUE INDEX "BillingTemplate_team_slug_key" ON "BillingTemplate"("teamId", "slug");
CREATE INDEX "BillingTemplateVersion_templateId_idx" ON "BillingTemplateVersion"("templateId");
CREATE UNIQUE INDEX "BillingTemplateVersion_templateId_version_key" ON "BillingTemplateVersion"("templateId", "version");
CREATE INDEX "TemplateInstall_team_env_status_idx" ON "TemplateInstall"("teamId", "environmentMode", "status");
CREATE UNIQUE INDEX "TemplateInstall_team_template_env_chain_key" ON "TemplateInstall"("teamId", "templateId", "environmentMode", "chainId");

CREATE UNIQUE INDEX "TaxProfile_teamId_key" ON "TaxProfile"("teamId");
CREATE INDEX "InvoiceSequence_team_idx" ON "InvoiceSequence"("teamId");
CREATE UNIQUE INDEX "InvoiceSequence_team_year_key" ON "InvoiceSequence"("teamId", "year");
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX "Invoice_team_status_issuedAt_idx" ON "Invoice"("teamId", "status", "issuedAt");
CREATE INDEX "Invoice_team_env_idx" ON "Invoice"("teamId", "environmentMode");
CREATE INDEX "InvoiceLine_invoice_idx" ON "InvoiceLine"("invoiceId");
CREATE INDEX "InvoiceDelivery_invoice_status_idx" ON "InvoiceDelivery"("invoiceId", "status");
CREATE UNIQUE INDEX "CreditNote_noteNumber_key" ON "CreditNote"("noteNumber");
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

CREATE INDEX "AuditEvent_team_created_idx" ON "AuditEvent"("teamId", "createdAt");
CREATE INDEX "AuditEvent_team_action_idx" ON "AuditEvent"("teamId", "action");
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");
CREATE UNIQUE INDEX "BillingEvent_idempotency_key" ON "BillingEvent"("idempotencyKey");
CREATE INDEX "BillingEvent_team_created_idx" ON "BillingEvent"("teamId", "createdAt");
CREATE INDEX "BillingEvent_team_processed_idx" ON "BillingEvent"("teamId", "processed");
CREATE UNIQUE INDEX "WebhookDelivery_deliveryId_key" ON "WebhookDelivery"("deliveryId");
CREATE INDEX "WebhookDelivery_team_deliveredAt_idx" ON "WebhookDelivery"("teamId", "deliveredAt");
CREATE INDEX "WebhookDelivery_team_success_idx" ON "WebhookDelivery"("teamId", "success");

-- Foreign keys
ALTER TABLE "CatalogPlan" ADD CONSTRAINT "CatalogPlan_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogAddOn" ADD CONSTRAINT "CatalogAddOn_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogCreditType" ADD CONSTRAINT "CatalogCreditType_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogVersion" ADD CONSTRAINT "CatalogVersion_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingTemplate" ADD CONSTRAINT "BillingTemplate_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingTemplateVersion" ADD CONSTRAINT "BillingTemplateVersion_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "BillingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateInstall" ADD CONSTRAINT "TemplateInstall_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateInstall" ADD CONSTRAINT "TemplateInstall_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "BillingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceDelivery" ADD CONSTRAINT "InvoiceDelivery_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
