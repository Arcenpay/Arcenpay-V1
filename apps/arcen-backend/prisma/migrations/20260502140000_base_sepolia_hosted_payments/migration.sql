DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AddOnSaleMode') THEN
    CREATE TYPE "AddOnSaleMode" AS ENUM ('STANDALONE', 'UPSELL', 'BOTH');
  END IF;
END $$;

ALTER TYPE "PaymentKind" ADD VALUE IF NOT EXISTS 'ADDON_PURCHASE';
ALTER TYPE "PaymentKind" ADD VALUE IF NOT EXISTS 'CUSTOM_PAYMENT';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CompanyAddOnGrantStatus') THEN
    CREATE TYPE "CompanyAddOnGrantStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'REVOKED', 'EXPIRED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CompanyAddOnGrantSource') THEN
    CREATE TYPE "CompanyAddOnGrantSource" AS ENUM ('ADMIN', 'ADDON_PURCHASE', 'PAYMENT_LINK', 'INVOICE', 'SUBSCRIPTION_UPSELL');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentLinkKind') THEN
    CREATE TYPE "PaymentLinkKind" AS ENUM ('ADDON', 'INVOICE', 'CUSTOM');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentLinkStatus') THEN
    CREATE TYPE "PaymentLinkStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CheckoutSessionPurpose') THEN
    CREATE TYPE "CheckoutSessionPurpose" AS ENUM ('ADDON', 'INVOICE', 'CUSTOM');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CheckoutSessionStatus') THEN
    CREATE TYPE "CheckoutSessionStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED');
  END IF;
END $$;

ALTER TABLE "CatalogAddOn"
  ADD COLUMN IF NOT EXISTS "saleMode" "AddOnSaleMode" NOT NULL DEFAULT 'STANDALONE',
  ADD COLUMN IF NOT EXISTS "billingIntervalDays" INTEGER;

CREATE TABLE IF NOT EXISTS "PaymentLink" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "teamId" TEXT NOT NULL,
  "kind" "PaymentLinkKind" NOT NULL,
  "status" "PaymentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "companyId" TEXT,
  "catalogAddOnId" TEXT,
  "invoiceId" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "amount" DECIMAL(20,6) NOT NULL,
  "acceptedToken" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL DEFAULT 84532,
  "recipientWallet" TEXT NOT NULL,
  "successUrl" TEXT,
  "cancelUrl" TEXT,
  "expiresAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentLink_slug_key" ON "PaymentLink"("slug");
CREATE INDEX IF NOT EXISTS "PaymentLink_teamId_status_kind_idx" ON "PaymentLink"("teamId", "status", "kind");
CREATE INDEX IF NOT EXISTS "PaymentLink_teamId_companyId_idx" ON "PaymentLink"("teamId", "companyId");
CREATE INDEX IF NOT EXISTS "PaymentLink_teamId_catalogAddOnId_idx" ON "PaymentLink"("teamId", "catalogAddOnId");
CREATE INDEX IF NOT EXISTS "PaymentLink_teamId_invoiceId_idx" ON "PaymentLink"("teamId", "invoiceId");

ALTER TABLE "PaymentLink"
  ADD CONSTRAINT "PaymentLink_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentLink_catalogAddOnId_fkey" FOREIGN KEY ("catalogAddOnId") REFERENCES "CatalogAddOn"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentLink_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "CheckoutSession" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "teamId" TEXT NOT NULL,
  "paymentLinkId" TEXT,
  "companyId" TEXT,
  "catalogAddOnId" TEXT,
  "invoiceId" TEXT,
  "paymentId" TEXT,
  "subscriptionStateId" TEXT,
  "purpose" "CheckoutSessionPurpose" NOT NULL,
  "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'PENDING',
  "customerEmail" TEXT,
  "customerWallet" TEXT,
  "customerName" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "amount" DECIMAL(20,6) NOT NULL,
  "acceptedToken" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL DEFAULT 84532,
  "recipientWallet" TEXT NOT NULL,
  "txHash" TEXT,
  "verificationError" TEXT,
  "successUrl" TEXT,
  "cancelUrl" TEXT,
  "expiresAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutSession_txHash_key" ON "CheckoutSession"("txHash");
CREATE INDEX IF NOT EXISTS "CheckoutSession_teamId_status_createdAt_idx" ON "CheckoutSession"("teamId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "CheckoutSession_teamId_paymentLinkId_idx" ON "CheckoutSession"("teamId", "paymentLinkId");
CREATE INDEX IF NOT EXISTS "CheckoutSession_teamId_companyId_idx" ON "CheckoutSession"("teamId", "companyId");
CREATE INDEX IF NOT EXISTS "CheckoutSession_teamId_catalogAddOnId_idx" ON "CheckoutSession"("teamId", "catalogAddOnId");
CREATE INDEX IF NOT EXISTS "CheckoutSession_teamId_invoiceId_idx" ON "CheckoutSession"("teamId", "invoiceId");
CREATE INDEX IF NOT EXISTS "CheckoutSession_teamId_subscriptionStateId_idx" ON "CheckoutSession"("teamId", "subscriptionStateId");

ALTER TABLE "CheckoutSession"
  ADD CONSTRAINT "CheckoutSession_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CheckoutSession_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CheckoutSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CheckoutSession_catalogAddOnId_fkey" FOREIGN KEY ("catalogAddOnId") REFERENCES "CatalogAddOn"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CheckoutSession_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CheckoutSession_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CheckoutSession_subscriptionStateId_fkey" FOREIGN KEY ("subscriptionStateId") REFERENCES "SubscriptionState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "CompanyAddOnGrant" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "teamId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "catalogAddOnId" TEXT NOT NULL,
  "status" "CompanyAddOnGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "CompanyAddOnGrantSource" NOT NULL,
  "paymentId" TEXT,
  "checkoutSessionId" TEXT,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "cancelledAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "CompanyAddOnGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CompanyAddOnGrant_teamId_companyId_status_idx" ON "CompanyAddOnGrant"("teamId", "companyId", "status");
CREATE INDEX IF NOT EXISTS "CompanyAddOnGrant_teamId_catalogAddOnId_status_idx" ON "CompanyAddOnGrant"("teamId", "catalogAddOnId", "status");
CREATE INDEX IF NOT EXISTS "CompanyAddOnGrant_paymentId_idx" ON "CompanyAddOnGrant"("paymentId");
CREATE INDEX IF NOT EXISTS "CompanyAddOnGrant_checkoutSessionId_idx" ON "CompanyAddOnGrant"("checkoutSessionId");

ALTER TABLE "CompanyAddOnGrant"
  ADD CONSTRAINT "CompanyAddOnGrant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanyAddOnGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanyAddOnGrant_catalogAddOnId_fkey" FOREIGN KEY ("catalogAddOnId") REFERENCES "CatalogAddOn"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanyAddOnGrant_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanyAddOnGrant_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "CheckoutSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
