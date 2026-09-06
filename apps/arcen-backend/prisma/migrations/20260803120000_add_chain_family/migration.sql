-- Add ChainFamily enum + chainFamily column to every model that carries a
-- chainId. This is the data-layer prerequisite for multi-chain support
-- (Stellar and future non-EVM chains). See packages/internal-core/src/chain-family.ts.
--
-- Default 'EVM' keeps all existing rows valid: every chainId in production
-- today is a real EVM chain id, so existing rows belong to the EVM family.
-- Future rows on Stellar synthetic chainIds (9_000_000–9_000_002) MUST set
-- chainFamily = 'STELLAR' at insert time.
--
-- Column is non-null with a default → additive, no backfill needed.

CREATE TYPE "ChainFamily" AS ENUM ('EVM', 'STELLAR');

-- WorkspaceEnvironment
ALTER TABLE "WorkspaceEnvironment"
  ADD COLUMN "chainFamily" "ChainFamily" NOT NULL DEFAULT 'EVM';
CREATE INDEX "WorkspaceEnvironment_teamId_chainFamily_idx"
  ON "WorkspaceEnvironment" ("teamId", "chainFamily");

-- CatalogPlan
ALTER TABLE "CatalogPlan"
  ADD COLUMN "chainFamily" "ChainFamily" NOT NULL DEFAULT 'EVM';
CREATE INDEX "CatalogPlan_teamId_chainFamily_chainId_idx"
  ON "CatalogPlan" ("teamId", "chainFamily", "chainId");

-- TemplateInstall
ALTER TABLE "TemplateInstall"
  ADD COLUMN "chainFamily" "ChainFamily" NOT NULL DEFAULT 'EVM';

-- SubscriptionState
ALTER TABLE "SubscriptionState"
  ADD COLUMN "chainFamily" "ChainFamily" NOT NULL DEFAULT 'EVM';
CREATE INDEX "SubscriptionState_teamId_chainFamily_chainId_idx"
  ON "SubscriptionState" ("teamId", "chainFamily", "chainId");

-- PlatformBillingPlan
ALTER TABLE "PlatformBillingPlan"
  ADD COLUMN "chainFamily" "ChainFamily" NOT NULL DEFAULT 'EVM';
CREATE INDEX "PlatformBillingPlan_environmentId_chainFamily_chainId_idx"
  ON "PlatformBillingPlan" ("environmentId", "chainFamily", "chainId");

-- GasSpend (EVM gas accounting; column remains for symmetry/filtering)
ALTER TABLE "GasSpend"
  ADD COLUMN "chainFamily" "ChainFamily" NOT NULL DEFAULT 'EVM';
CREATE INDEX "GasSpend_teamId_chainFamily_idx"
  ON "GasSpend" ("teamId", "chainFamily");

-- PaymentLink
ALTER TABLE "PaymentLink"
  ADD COLUMN "chainFamily" "ChainFamily" NOT NULL DEFAULT 'EVM';

-- CheckoutSession
ALTER TABLE "CheckoutSession"
  ADD COLUMN "chainFamily" "ChainFamily" NOT NULL DEFAULT 'EVM';