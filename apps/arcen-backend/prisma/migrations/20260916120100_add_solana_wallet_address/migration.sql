-- Add a Solana wallet address to User, mirroring the existing
-- stellarWalletAddress field (added in 20260803105241_add_stellar_wallet_address).
-- Base58 addresses are case-sensitive, so the value is stored exactly as
-- signed. Nullable + unique: existing rows are unaffected.

ALTER TABLE "User" ADD COLUMN "solanaWalletAddress" TEXT;
CREATE UNIQUE INDEX "User_solanaWalletAddress_key" ON "User" ("solanaWalletAddress");
CREATE INDEX "User_solanaWalletAddress_idx" ON "User" ("solanaWalletAddress");
