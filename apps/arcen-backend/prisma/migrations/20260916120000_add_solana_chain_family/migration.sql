-- Add 'SOLANA' to the ChainFamily enum. This is the data-layer prerequisite
-- for Solana multi-chain support (synthetic chainIds 9_100_000–9_100_002).
-- See packages/internal-core/src/chain-family.ts.
--
-- Additive only: no column changes, no backfill. Existing rows keep their
-- current family (EVM/STELLAR). New Solana rows MUST set chainFamily = 'SOLANA'
-- at insert time. PostgreSQL supports ADD VALUE transactionally since v12 as
-- long as the new value is not used in the same transaction — this migration
-- only declares it.

ALTER TYPE "ChainFamily" ADD VALUE 'SOLANA';
