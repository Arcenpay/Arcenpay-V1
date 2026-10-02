import { getChainFamily } from "@arcenpay/internal-core";

export type ChainFamilyPrisma = "EVM" | "STELLAR" | "SOLANA";

/**
 * Wallet-address format accepted across the platform (crypto destination
 * wallets in auth, invoices, payment links…). Must cover every supported chain
 * family — a missing family silently rejects that family's entire flow:
 *   - EVM:     `0x` + 40 hex
 *   - Stellar: `G…`/`C…` 56-char base32, or a 64-hex hash
 *   - Solana:  base58, 32–44 chars
 */
export const WALLET_ADDRESS_REGEX =
  /^(0x[a-fA-F0-9]{40}|G[A-Z2-7]{55}|C[A-Z0-9]{55}|[A-Fa-f0-9]{64}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

/**
 * Resolve the Prisma `ChainFamily` enum value for a given chainId.
 *
 * The internal-core `getChainFamily` helper returns lowercase strings
 * ("evm" | "stellar" | "solana" | null); the Prisma enum uses uppercase
 * values. This helper performs the casing conversion.
 *
 * Only known families resolve to their enum value. Unknown ids that fall
 * inside the EVM range (below the synthetic non-EVM range) are treated as
 * EVM so legacy EVM-only inserts keep working; any id above the EVM range
 * that is not a registered synthetic chain is a misconfiguration and
 * throws — silently tagging it "EVM" would corrupt chainFamily-scoped
 * billing rows.
 */
export function resolveChainFamilyForPrisma(chainId: number): ChainFamilyPrisma {
  const family = getChainFamily(chainId);
  if (family === "stellar") return "STELLAR";
  if (family === "solana") return "SOLANA";
  if (family === "evm") return "EVM";
  throw new Error(
    `[resolveChainFamilyForPrisma] Unknown chain family for chainId ${chainId}. ` +
      `Register the chain in packages/internal-core/src/chain-family.ts CHAIN_REGISTRY.`,
  );
}