-- Add chainFamily to Payment and ArcenAgentConfig.
--
-- Payment: records created today are all EVM settlements, so a non-null
-- default of 'EVM' keeps existing rows valid without a backfill. New
-- Stellar checkout/agent payments set chainFamily = 'STELLAR' at insert.
--
-- ArcenAgentConfig: chainId/chainFamily are nullable so existing teams
-- (which predate the multi-chain agent work) keep working; absence means
-- the legacy EVM behavior. New Stellar agent configs set both.

-- Payment
ALTER TABLE "Payment"
  ADD COLUMN "chainFamily" "ChainFamily" NOT NULL DEFAULT 'EVM';

-- ArcenAgentConfig
ALTER TABLE "ArcenAgentConfig"
  ADD COLUMN "chainId" INTEGER,
  ADD COLUMN "chainFamily" "ChainFamily" NOT NULL DEFAULT 'EVM';
CREATE INDEX "ArcenAgentConfig_teamId_chainFamily_idx"
  ON "ArcenAgentConfig" ("teamId", "chainFamily");
