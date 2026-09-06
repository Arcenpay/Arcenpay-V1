import { getChainFamily } from "@arcenpay/internal-core";

export type ChainFamilyPrisma = "EVM" | "STELLAR";

/**
 * Resolve the Prisma `ChainFamily` enum value for a given chainId.
 *
 * The internal-core `getChainFamily` helper returns lowercase strings
 * ("evm" | "stellar" | null); the Prisma enum uses uppercase values
 * ("EVM" | "STELLAR"). This helper performs the casing conversion and
 * falls back to "EVM" for any unknown id below the synthetic-Stellar
 * range, so legacy EVM-only inserts keep working without enumerating
 * every supported chain.
 *
 * Returns "STELLAR" only for known Stellar synthetic ids (9_000_000+).
 * Never throws — chainFamily derivation must remain additive / non-breaking.
 */
export function resolveChainFamilyForPrisma(chainId: number): ChainFamilyPrisma {
  const family = getChainFamily(chainId);
  if (family === "stellar") return "STELLAR";
  return "EVM";
}