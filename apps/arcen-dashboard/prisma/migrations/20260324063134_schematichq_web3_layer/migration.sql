-- CreateTable
CREATE TABLE "SchematicCompany" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "walletAddress" TEXT,
    "email" TEXT,
    "externalId" TEXT,
    "logoUrl" TEXT,
    "traits" JSONB NOT NULL DEFAULT '{}',
    "activePlanId" TEXT,
    "activeAddOnIds" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "SchematicCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchematicUser" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "walletAddress" TEXT,
    "clerkUserId" TEXT,
    "externalId" TEXT,
    "traits" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "SchematicUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchematicEvent" (
    "id" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "name" TEXT,
    "companyId" TEXT,
    "userId" TEXT,
    "traits" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "SchematicEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogFeatureFlag" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultValue" BOOLEAN NOT NULL DEFAULT false,
    "featureType" TEXT NOT NULL DEFAULT 'boolean',
    "eventKey" TEXT,
    "unitSingular" TEXT,
    "unitPlural" TEXT,

    CONSTRAINT "CatalogFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlagRule" (
    "id" TEXT NOT NULL,
    "flagId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "value" BOOLEAN NOT NULL,

    CONSTRAINT "FlagRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlagRuleCondition" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "criteriaType" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '[]',
    "metricKey" TEXT,
    "metricValue" DOUBLE PRECISION,
    "metricPeriod" TEXT,
    "traitKey" TEXT,
    "zktlsProviderId" TEXT,

    CONSTRAINT "FlagRuleCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyOverride" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "value" BOOLEAN NOT NULL,
    "reason" TEXT,

    CONSTRAINT "CompanyOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbedAccessToken" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmbedAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchematicApiKey" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "SchematicApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZkTlsProof" (
    "id" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT,
    "providerId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "claimData" JSONB NOT NULL,
    "proofHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ZkTlsProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbedComponent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "elements" JSONB NOT NULL DEFAULT '[]',
    "design" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "EmbedComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchematicCompany_teamId_email_idx" ON "SchematicCompany"("teamId", "email");

-- CreateIndex
CREATE INDEX "SchematicCompany_teamId_lastSeenAt_idx" ON "SchematicCompany"("teamId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchematicCompany_teamId_walletAddress_key" ON "SchematicCompany"("teamId", "walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "SchematicCompany_teamId_externalId_key" ON "SchematicCompany"("teamId", "externalId");

-- CreateIndex
CREATE INDEX "SchematicUser_teamId_companyId_idx" ON "SchematicUser"("teamId", "companyId");

-- CreateIndex
CREATE INDEX "SchematicUser_teamId_externalId_idx" ON "SchematicUser"("teamId", "externalId");

-- CreateIndex
CREATE INDEX "SchematicUser_teamId_email_idx" ON "SchematicUser"("teamId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "SchematicUser_teamId_walletAddress_key" ON "SchematicUser"("teamId", "walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "SchematicUser_teamId_clerkUserId_key" ON "SchematicUser"("teamId", "clerkUserId");

-- CreateIndex
CREATE INDEX "SchematicEvent_teamId_name_companyId_sentAt_idx" ON "SchematicEvent"("teamId", "name", "companyId", "sentAt");

-- CreateIndex
CREATE INDEX "SchematicEvent_teamId_eventType_sentAt_idx" ON "SchematicEvent"("teamId", "eventType", "sentAt");

-- CreateIndex
CREATE INDEX "SchematicEvent_teamId_companyId_sentAt_idx" ON "SchematicEvent"("teamId", "companyId", "sentAt");

-- CreateIndex
CREATE INDEX "CatalogFeatureFlag_teamId_idx" ON "CatalogFeatureFlag"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogFeatureFlag_teamId_featureKey_key" ON "CatalogFeatureFlag"("teamId", "featureKey");

-- CreateIndex
CREATE INDEX "FlagRule_flagId_priority_idx" ON "FlagRule"("flagId", "priority");

-- CreateIndex
CREATE INDEX "FlagRuleCondition_ruleId_idx" ON "FlagRuleCondition"("ruleId");

-- CreateIndex
CREATE INDEX "CompanyOverride_teamId_companyId_idx" ON "CompanyOverride"("teamId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyOverride_companyId_featureKey_key" ON "CompanyOverride"("companyId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmbedAccessToken_tokenHash_key" ON "EmbedAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmbedAccessToken_teamId_idx" ON "EmbedAccessToken"("teamId");

-- CreateIndex
CREATE INDEX "EmbedAccessToken_expiresAt_idx" ON "EmbedAccessToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchematicApiKey_keyHash_key" ON "SchematicApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "SchematicApiKey_teamId_idx" ON "SchematicApiKey"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ZkTlsProof_proofHash_key" ON "ZkTlsProof"("proofHash");

-- CreateIndex
CREATE INDEX "ZkTlsProof_teamId_companyId_idx" ON "ZkTlsProof"("teamId", "companyId");

-- CreateIndex
CREATE INDEX "ZkTlsProof_teamId_providerId_idx" ON "ZkTlsProof"("teamId", "providerId");

-- CreateIndex
CREATE INDEX "ZkTlsProof_expiresAt_idx" ON "ZkTlsProof"("expiresAt");

-- CreateIndex
CREATE INDEX "EmbedComponent_teamId_idx" ON "EmbedComponent"("teamId");

-- AddForeignKey
ALTER TABLE "SchematicCompany" ADD CONSTRAINT "SchematicCompany_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchematicUser" ADD CONSTRAINT "SchematicUser_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchematicEvent" ADD CONSTRAINT "SchematicEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogFeatureFlag" ADD CONSTRAINT "CatalogFeatureFlag_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlagRule" ADD CONSTRAINT "FlagRule_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "CatalogFeatureFlag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlagRuleCondition" ADD CONSTRAINT "FlagRuleCondition_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "FlagRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyOverride" ADD CONSTRAINT "CompanyOverride_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchematicApiKey" ADD CONSTRAINT "SchematicApiKey_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZkTlsProof" ADD CONSTRAINT "ZkTlsProof_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "SchematicCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZkTlsProof" ADD CONSTRAINT "ZkTlsProof_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SchematicUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedComponent" ADD CONSTRAINT "EmbedComponent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
