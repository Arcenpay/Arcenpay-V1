-- CreateTable
CREATE TABLE "ArcenAgentConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "autoTopUp" JSONB NOT NULL DEFAULT '{"mode":"off","dailyLimit":"5.00","perTxnLimit":"1.00","threshold":"0.50"}',
    "dispatch" JSONB NOT NULL DEFAULT '{"enabled":false,"providers":[],"cooldownSeconds":120,"maxRetries":3}',

    CONSTRAINT "ArcenAgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArcenDispatchRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT NOT NULL,
    "agentAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL,
    "providerTarget" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ArcenDispatchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArcenAgentConfig_teamId_key" ON "ArcenAgentConfig"("teamId");

-- CreateIndex
CREATE INDEX "ArcenAgentConfig_teamId_idx" ON "ArcenAgentConfig"("teamId");

-- CreateIndex
CREATE INDEX "ArcenDispatchRequest_teamId_status_idx" ON "ArcenDispatchRequest"("teamId", "status");

-- CreateIndex
CREATE INDEX "ArcenDispatchRequest_teamId_createdAt_idx" ON "ArcenDispatchRequest"("teamId", "createdAt");

-- AddForeignKey
ALTER TABLE "ArcenAgentConfig" ADD CONSTRAINT "ArcenAgentConfig_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcenDispatchRequest" ADD CONSTRAINT "ArcenDispatchRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
