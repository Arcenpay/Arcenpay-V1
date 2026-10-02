// ============================================================
//  ArcenPay Internal Core — Chain Family & Multi-Chain Registry
//
//  The platform historically assumed a single chain family (EVM).
//  Adding Stellar (and future chains: Solana, …) requires a
//  typed notion of "chain family" that determines:
//    - address encoding (hex 0x… for EVM, G…/C… for Stellar)
//    - RPC client construction (viem vs stellar-sdk)
    // - event sourcing strategy (eth_getLogs vs soroban getEvents)
//    - wallet connection (wagmi/Reown vs Freighter)
//    - idempotency-key/tx-hash validation rules
//
//  To avoid a risky wide refactor of the Prisma `chainId Int` columns,
//  every chain — regardless of family — is assigned a UNIQUE numeric
//  `chainId`. EVM chains keep their real EVM chain IDs (11155111, 84532…).
//  Non-EVM chains get synthetic IDs from a dedicated range that will
//  never collide with EVM's uint256 space.
//
//  Synthetic ID ranges (reserved, never to be used by EVM):
//    9_000_000–9_999_999   non-EVM chains
//      9_000_000/9_000_001  Stellar (mainnet/testnet)
//      9_100_000+           Solana / future chains
//
//  All Stellar/Stellar testnet chainIds in the codebase MUST be
//  sourced from the constants below — never hardcode.
// ============================================================

/**
 * A chain family is a peer protocol family with its own address format,
 * RPC style, transaction model, and wallet ecosystem.
 *
 * Adding a new family:
 *   1. Add a member to this union.
 *   2. Extend `CHAIN_FAMILY_METADATA` with `displayName`, `addressPattern`,
 *      a `txHashPattern`, and the synthetic chainId range.
 *   3. Register chain(s) in `CHAIN_REGISTRY` below.
 *   4. Implement a `ChainAdapter` in the facilitator for the family.
 *   5. Wire a wallet provider in the dashboard.
 */
export type ChainFamily = "evm" | "stellar" | "solana";

/**
 * Metadata describing the on-chain encoding rules for a chain family.
 * Used by validation helpers, the facilitator adapter registry,
 * idempotency-key derivation, and the dashboard wallet layer.
 */
export interface ChainFamilyMetadata {
  /** Human-readable family name, e.g. "EVM", "Stellar". */
  readonly displayName: string;
  /** Regex source matching a contract/wallet address for this family. */
  readonly addressPattern: string;
  /** Regex source matching a transaction hash for this family. */
  readonly txHashPattern: string;
  /** Lower bound (inclusive) of the synthetic chainId range for the family. */
  readonly syntheticIdRangeStart: number;
  /** Upper bound (inclusive) of the synthetic chainId range for the family. */
  readonly syntheticIdRangeEnd: number;
}

export const CHAIN_FAMILY_METADATA: Record<ChainFamily, ChainFamilyMetadata> = {
  evm: {
    displayName: "EVM",
    // 20-byte hex, 0x-prefixed, checksummed or lowercase
    addressPattern: "^0x[a-fA-F0-9]{40}$",
    // 32-byte hex tx hash
    txHashPattern: "^0x[a-fA-F0-9]{64}$",
    // EVM uses real chain IDs; they live below the synthetic range.
    syntheticIdRangeStart: 0,
    syntheticIdRangeEnd: 8_999_999,
  },
  stellar: {
    displayName: "Stellar",
    // Stellar account: G + 46 base32 chars (S… is a secret — never valid here)
    // Contract ID: hex-like C… or 56-char base32 — accept both forms.
    addressPattern: "^(G[A-Z2-7]{55}|C[A-Z0-9]{55}|[A-F0-9]{64})$",
    // Soroban tx hash: 64 hex chars (no 0x prefix by convention)
    txHashPattern: "^[a-fA-F0-9]{64}$",
    syntheticIdRangeStart: 9_000_000,
    syntheticIdRangeEnd: 9_999_999,
  },
  solana: {
    displayName: "Solana",
    // Solana addresses are base58-encoded ed25519 public keys: 32–44 chars.
    // Program/user accounts share the same encoding (no prefix distinction).
    addressPattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    // Solana transaction signature: base58-encoded 64-byte signature (~87–88 chars).
    txHashPattern: "^[1-9A-HJ-NP-Za-km-z]{86,90}$",
    // Solana gets its own sub-range so it never collides with Stellar's.
    syntheticIdRangeStart: 9_100_000,
    syntheticIdRangeEnd: 9_199_999,
  },
};

// ─── Synthetic chainId registry (non-EVM only) ──────────────────────────────
//
// EVM chains use their real numeric chainId (11155111 etc.) and are NOT
// listed here. Only non-EVM chains need a synthetic id assignment.

/**
 * Stellar Mainnet (Public Network). Synthetic chainId 9_000_000.
 */
export const STELLAR_MAINNET_CHAIN_ID = 9_000_000 as const;

/**
 * Stellar Testnet. Synthetic chainId 9_000_001.
 */
export const STELLAR_TESTNET_CHAIN_ID = 9_000_001 as const;

/**
 * Stellar Futurenet (used for early Soroban dev). Synthetic chainId 9_000_002.
 */
export const STELLAR_FUTURENET_CHAIN_ID = 9_000_002 as const;

const STELLAR_SYNTHETIC_IDS = [
  STELLAR_MAINNET_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
  STELLAR_FUTURENET_CHAIN_ID,
] as const;

// ─── Solana synthetic chainIds (reserved 9_100_000+) ────────────────────────

/**
 * Solana Mainnet Beta. Synthetic chainId 9_100_000.
 */
export const SOLANA_MAINNET_CHAIN_ID = 9_100_000 as const;

/**
 * Solana Devnet (used for development/testing). Synthetic chainId 9_100_001.
 */
export const SOLANA_DEVNET_CHAIN_ID = 9_100_001 as const;

/**
 * Solana Testnet (validator test network). Synthetic chainId 9_100_002.
 */
export const SOLANA_TESTNET_CHAIN_ID = 9_100_002 as const;

const SOLANA_SYNTHETIC_IDS = [
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_TESTNET_CHAIN_ID,
] as const;

// ─── Chain registry ──────────────────────────────────────────────────────────

/**
 * Network passphrase is Stellar's analogue to EVM chainId — it uniquely
 * identifies the network. We surface it here so facilitator/SDK code can
 * construct a stellar-sdk Server with the right passphrase without needing
 * a separate config table.
 */
export interface ChainDescriptor {
  /** Synthetic or real numeric chainId — unique across all families. */
  readonly chainId: number;
  /** Human-readable chain name (e.g. "Stellar Testnet"). */
  readonly name: string;
  /** Chain family. */
  readonly family: ChainFamily;
  /** Testnet flag. */
  readonly testnet: boolean;
  /**
   * Stellar network passphrase (Stellar only). EVM chains leave this null.
   * The passphrase's SHA-256 is the network id used in transaction signing
   * and contract address generation — a wrong passphrase makes signatures
   * invalid. Canonical values (per https://developers.stellar.org/docs/networks):
   *   Public  : "Public Global Stellar Network ; September 2015"
   *   Testnet : "Test SDF Network ; September 2015"
   *   Futurenet: "Test SDF Future Network ; October 2022"
   */
  readonly networkPassphrase: string | null;
  /**
   * Default RPC URL. For EVM, omit (resolved via viem chain defs).
   * For Stellar this is the Horizon REST URL (account/tx reads).
   * See `sorobanRpcUrl` for smart-contract interactions.
   */
  readonly rpcUrl?: string;
  /**
   * Stellar-only: Soroban RPC URL for smart-contract calls, getEvents,
   * simulateTransaction, sendTransaction. Distinct from Horizon (rpcUrl).
   * Sources: https://developers.stellar.org/docs/networks
   *   Mainnet   : third-party providers only (no SDF endpoint) — set via env.
   *   Testnet   : https://soroban-testnet.stellar.org
   *   Futurenet : https://rpc-futurenet.stellar.org
   */
  readonly sorobanRpcUrl?: string;
  /** Default block explorer base URL (no trailing slash). */
  readonly blockExplorerUrl?: string;
  /** Native currency symbol for display. EVM: 'ETH'. Stellar: 'XLM'. */
  readonly nativeCurrencySymbol?: string;
}

/**
 * The consolidated registry of ALL chains the platform supports across
 * every family. The EVM entries mirror `chains.ts`; the Stellar entries
 * are defined here. This is the single source of truth for chain identity.
 *
 * To add a chain:
 *   - EVM: add a `defineChain()` in `chains.ts` AND a descriptor here.
 *   - Non-EVM: allocate a synthetic chainId from the family's range and add
 *     a descriptor here.
 */
export const CHAIN_REGISTRY: Record<number, ChainDescriptor> = {
  // ── EVM ──
  11155111: {
    chainId: 11155111,
    name: "Sepolia",
    family: "evm",
    testnet: true,
    networkPassphrase: null,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    blockExplorerUrl: "https://sepolia.etherscan.io",
    nativeCurrencySymbol: "ETH",
  },
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    family: "evm",
    testnet: true,
    networkPassphrase: null,
    rpcUrl: "https://sepolia.base.org",
    blockExplorerUrl: "https://sepolia.basescan.org",
    nativeCurrencySymbol: "ETH",
  },
  8453: {
    chainId: 8453,
    name: "Base",
    family: "evm",
    testnet: false,
    networkPassphrase: null,
    rpcUrl: "https://mainnet.base.org",
    blockExplorerUrl: "https://basescan.org",
    nativeCurrencySymbol: "ETH",
  },
  5042002: {
    chainId: 5042002,
    name: "Arc Testnet",
    family: "evm",
    testnet: true,
    networkPassphrase: null,
    rpcUrl: "https://rpc.testnet.arc.network",
    blockExplorerUrl: "https://testnet.arcscan.app",
    nativeCurrencySymbol: "USDC",
  },
  677: {
    chainId: 677,
    name: "BOT Chain",
    family: "evm",
    testnet: false,
    networkPassphrase: null,
    rpcUrl: "https://rpc.botchain.ai",
    blockExplorerUrl: "https://scan.botchain.ai",
    nativeCurrencySymbol: "BOT",
  },
  968: {
    chainId: 968,
    name: "BOT Chain Testnet",
    family: "evm",
    testnet: true,
    networkPassphrase: null,
    rpcUrl: "https://rpc.bohr.life",
    blockExplorerUrl: "https://scan.bohr.life",
    nativeCurrencySymbol: "BOT",
  },

  // ── Stellar ──
  // Network passphrases per https://developers.stellar.org/docs/networks.
  // Futurenet was created in October 2022 (NOT September 2015 — using the
  // wrong passphrase would make on-chain signatures invalid).
  // Soroban RPC URLs differ from Horizon REST URLs — the rpcUrl field holds
  // Horizon (good for account/tx reads); sorobanRpcUrl holds the Soroban RPC
  // endpoint required for contract getEvents / simulate / send.
  [STELLAR_MAINNET_CHAIN_ID]: {
    chainId: STELLAR_MAINNET_CHAIN_ID,
    name: "Stellar Mainnet",
    family: "stellar",
    testnet: false,
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "https://horizon.stellar.org",
    // SDF does NOT run a public Soroban RPC for Mainnet — use a third-party
    // provider. Override via env (ARCENPAY_STELLAR_RPC_URL_9000000).
    sorobanRpcUrl: "",
    blockExplorerUrl: "https://stellar.expert/explorer/public",
    nativeCurrencySymbol: "XLM",
  },
  [STELLAR_TESTNET_CHAIN_ID]: {
    chainId: STELLAR_TESTNET_CHAIN_ID,
    name: "Stellar Testnet",
    family: "stellar",
    testnet: true,
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://horizon-testnet.stellar.org",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    blockExplorerUrl: "https://stellar.expert/explorer/testnet",
    nativeCurrencySymbol: "XLM",
  },
  [STELLAR_FUTURENET_CHAIN_ID]: {
    chainId: STELLAR_FUTURENET_CHAIN_ID,
    name: "Stellar Futurenet",
    family: "stellar",
    testnet: true,
    networkPassphrase: "Test SDF Future Network ; October 2022",
    rpcUrl: "https://horizon-futurenet.stellar.org",
    sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
    blockExplorerUrl: "https://stellar.expert/explorer/futurenet",
    nativeCurrencySymbol: "XLM",
  },

  // ── Solana ──
  // Solana has no network passphrase — the RPC endpoint itself identifies the
  // cluster. `rpcUrl` holds the JSON-RPC endpoint; program ids live in
  // addresses.ts. Native currency is SOL (9 decimals) — not a stablecoin;
  // USDC is the Circle SPL mint registered in chains.ts TOKENS.
  [SOLANA_MAINNET_CHAIN_ID]: {
    chainId: SOLANA_MAINNET_CHAIN_ID,
    name: "Solana Mainnet",
    family: "solana",
    testnet: false,
    networkPassphrase: null,
    rpcUrl: "https://api.mainnet-beta.solana.com",
    blockExplorerUrl: "https://explorer.solana.com",
    nativeCurrencySymbol: "SOL",
  },
  [SOLANA_DEVNET_CHAIN_ID]: {
    chainId: SOLANA_DEVNET_CHAIN_ID,
    name: "Solana Devnet",
    family: "solana",
    testnet: true,
    networkPassphrase: null,
    rpcUrl: "https://api.devnet.solana.com",
    blockExplorerUrl: "https://explorer.solana.com/?cluster=devnet",
    nativeCurrencySymbol: "SOL",
  },
  [SOLANA_TESTNET_CHAIN_ID]: {
    chainId: SOLANA_TESTNET_CHAIN_ID,
    name: "Solana Testnet",
    family: "solana",
    testnet: true,
    networkPassphrase: null,
    rpcUrl: "https://api.testnet.solana.com",
    blockExplorerUrl: "https://explorer.solana.com/?cluster=testnet",
    nativeCurrencySymbol: "SOL",
  },
};

// ─── Chain-family lookup helpers ─────────────────────────────────────────────

/**
 * Returns the chain family for a chainId, or null if the chainId is unknown.
 *
 * Lookup order:
 *   1. Exact match in CHAIN_REGISTRY (covers both synthetic Stellar IDs and
 *      every EVM ID that has a descriptor).
 *   2. Fall back to "evm" if the id falls within the EVM range (real EVM
 *      chainIds may be present in TOKENS/addresses but not yet in the
 *      registry, e.g. a freshly-added testnet).
 */
export function getChainFamily(chainId: number): ChainFamily | null {
  const descriptor = CHAIN_REGISTRY[chainId];
  if (descriptor) return descriptor.family;

  // Unknown id — assume EVM if it is below the synthetic range. This keeps
  // existing EVM-only call sites working without enumerating every chain.
  if (chainId < CHAIN_FAMILY_METADATA.stellar.syntheticIdRangeStart) {
    return "evm";
  }
  return null;
}

/** True if the chainId belongs to the EVM family. */
export function isEvmChain(chainId: number): boolean {
  return getChainFamily(chainId) === "evm";
}

/** True if the chainId belongs to the Stellar family. */
export function isStellarChain(chainId: number): boolean {
  return getChainFamily(chainId) === "stellar";
}

/** True if the chain is one of the known Stellar synthetic IDs. */
export function isStellarChainId(chainId: number): boolean {
  return (STELLAR_SYNTHETIC_IDS as readonly number[]).includes(chainId);
}

/** True if the chainId belongs to the Solana family. */
export function isSolanaChain(chainId: number): boolean {
  return getChainFamily(chainId) === "solana";
}

/** True if the chain is one of the known Solana synthetic IDs. */
export function isSolanaChainId(chainId: number): boolean {
  return (SOLANA_SYNTHETIC_IDS as readonly number[]).includes(chainId);
}

/**
 * Returns the chain descriptor for a chainId, or null if unknown.
 * Prefer this over the legacy viem-based `getChain()` when you only need
 * identity/family/passphrase — it works for ALL families.
 */
export function getChainDescriptor(chainId: number): ChainDescriptor | null {
  return CHAIN_REGISTRY[chainId] ?? null;
}

/**
 * Returns the Stellar network passphrase for a Stellar chainId.
 * Throws if the chainId is not a Stellar chain.
 */
export function getStellarNetworkPassphrase(chainId: number): string {
  const descriptor = CHAIN_REGISTRY[chainId];
  if (!descriptor || descriptor.family !== "stellar" || !descriptor.networkPassphrase) {
    throw new Error(
      `[getStellarNetworkPassphrase] chainId ${chainId} is not a Stellar chain. ` +
        `Known Stellar chainIds: ${STELLAR_SYNTHETIC_IDS.join(", ")}`,
    );
  }
  return descriptor.networkPassphrase;
}

/**
 * Returns the Soroban RPC URL for a Stellar chainId, applying env override if
 * set. The env var pattern (consistent with EVM RPC overrides) is:
 *   ARCENPAY_STELLAR_RPC_URL_<chainId>  ── primary
 *   STELLAR_RPC_URL_<chainId>          ── legacy alias
 *   STELLAR_RPC_URL                    ── global default
 *
 * Throws if the chainId is not a Stellar chain. Returns the empty string for
 * chains where no SDF RPC exists (e.g. Mainnet) and no override is configured
 * — callers must treat "" as "not configured" (and require an override in
 * production via `validateChainEnvironment`).
 */
export function getStellarSorobanRpcUrl(chainId: number): string {
  if (!isStellarChain(chainId)) {
    throw new Error(
      `[getStellarSorobanRpcUrl] chainId ${chainId} is not a Stellar chain. ` +
        `Known Stellar chainIds: ${STELLAR_SYNTHETIC_IDS.join(", ")}`,
    );
  }
  if (typeof process !== "undefined") {
    const specific =
      process.env[`ARCENPAY_STELLAR_RPC_URL_${chainId}`] ||
      process.env[`STELLAR_RPC_URL_${chainId}`];
    if (specific && specific.trim()) return specific.trim();
    const global = process.env.STELLAR_RPC_URL;
    if (global && global.trim()) return global.trim();
  }
  return CHAIN_REGISTRY[chainId]?.sorobanRpcUrl ?? "";
}

/**
 * Returns the Solana JSON-RPC URL for a Solana chainId, applying env override
 * if set. The env var pattern (consistent with the other families) is:
 *   ARCENPAY_SOLANA_RPC_URL_<chainId>  ── primary
 *   SOLANA_RPC_URL_<chainId>           ── legacy alias
 *   SOLANA_RPC_URL                     ── global default
 *
 * Throws if the chainId is not a Solana chain.
 */
export function getSolanaRpcUrl(chainId: number): string {
  if (!isSolanaChain(chainId)) {
    throw new Error(
      `[getSolanaRpcUrl] chainId ${chainId} is not a Solana chain. ` +
        `Known Solana chainIds: ${SOLANA_SYNTHETIC_IDS.join(", ")}`,
    );
  }
  if (typeof process !== "undefined") {
    const specific =
      process.env[`ARCENPAY_SOLANA_RPC_URL_${chainId}`] ||
      process.env[`SOLANA_RPC_URL_${chainId}`];
    if (specific && specific.trim()) return specific.trim();
    const global = process.env.SOLANA_RPC_URL;
    if (global && global.trim()) return global.trim();
  }
  return CHAIN_REGISTRY[chainId]?.rpcUrl ?? "";
}

/**
 * Ordered list of Solana RPC endpoints for a chain.
 *
 * A single env var may hold several comma/whitespace-separated URLs, so a chain
 * can be given a failover set (e.g. a primary provider + a free fallback)
 * without any code change. `getSolanaRpcUrl` keeps returning the first one, so
 * existing callers are unaffected.
 */
export function getSolanaRpcUrls(chainId: number): string[] {
  const urls = getSolanaRpcUrl(chainId)
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter(Boolean);
  return [...new Set(urls)];
}

/** Returns all registered chainIds (across all families). */
export function getAllRegisteredChainIds(): number[] {
  return Object.keys(CHAIN_REGISTRY).map((k) => Number(k));
}

/** Returns all registered chainIds for a specific family. */
export function getChainIdsForFamily(family: ChainFamily): number[] {
  return Object.values(CHAIN_REGISTRY)
    .filter((c) => c.family === family)
    .map((c) => c.chainId);
}

// ─── Address validation (family-aware) ──────────────────────────────────────

/**
 * Returns true if `value` is a valid address for the given chain family.
 *
 * For EVM: 20-byte hex, 0x-prefixed.
 * For Stellar: G… account (56 chars base32) or C… contract id, or 64-hex.
 *
 * The zero-address sentinel is considered valid for EVM (treated as
 * "unset placeholder" by existing address-registry code).
 */
export function isValidAddress(value: unknown, family: ChainFamily): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  const meta = CHAIN_FAMILY_METADATA[family];
  return new RegExp(meta.addressPattern).test(value);
}

/**
 * Returns true if `value` is a valid transaction hash for the family.
 *
 * For EVM: 32-byte hex, 0x-prefixed.
 * For Stellar: 64 hex chars (Soroban tx hash; no 0x prefix by convention).
 */
export function isValidTxHash(value: unknown, family: ChainFamily): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  const meta = CHAIN_FAMILY_METADATA[family];
  return new RegExp(meta.txHashPattern).test(value);
}

/**
 * Family-aware variant of {@link isValidAddress} keyed by chainId.
 * Resolves the family via {@link getChainFamily} and delegates.
 */
export function isValidAddressForChain(value: unknown, chainId: number): boolean {
  const family = getChainFamily(chainId);
  if (!family) return false;
  return isValidAddress(value, family);
}

/**
 * Family-aware variant of {@link isValidTxHash} keyed by chainId.
 */
export function isValidTxHashForChain(value: unknown, chainId: number): boolean {
  const family = getChainFamily(chainId);
  if (!family) return false;
  return isValidTxHash(value, family);
}

const ALL_CHAIN_FAMILIES: readonly ChainFamily[] = ["evm", "stellar", "solana"];

/**
 * True if `value` is a valid address shape on ANY supported chain family
 * (EVM 20-byte hex, Stellar G…/C…, Solana base58).
 *
 * Use where the chain is not known at the call site — e.g. a provider address
 * arriving on a path param, or an SDK hook that must not reject a Solana wallet.
 */
export function isValidAnyFamilyAddress(value: unknown): boolean {
  return ALL_CHAIN_FAMILIES.some((family) => isValidAddress(value, family));
}

/**
 * True if `value` is a valid transaction-hash shape on ANY supported family
 * (EVM 32-byte hex, Stellar 64-hex, Solana base58 signature).
 */
export function isValidAnyFamilyTxHash(value: unknown): boolean {
  return ALL_CHAIN_FAMILIES.some((family) => isValidTxHash(value, family));
}

/**
 * Family-agnostic hash normalization: only the EVM `0x…` shape is
 * case-insensitive. Solana base58 signatures and Stellar 64-hex must be
 * preserved verbatim (lowercasing a base58 signature corrupts it).
 */
export function normalizeAnyFamilyTxHash(value: string): string {
  return value.startsWith("0x") ? value.toLowerCase() : value;
}

/**
 * Normalizes a wallet address for a chain family without corrupting it.
 *
 * EVM addresses are case-insensitive hex — lowercased for canonical storage.
 * Stellar addresses are base32 (case-sensitive) — returned UNTOUCHED, since
 * lowercasing a G…/C… address corrupts it.
 *
 * Returns null for non-strings / empty values, mirroring `normalizeWallet`
 * in the backend billing utils.
 */
export function normalizeWalletForChain(
  value: unknown,
  chainId: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const family = getChainFamily(chainId);
  // EVM addresses are case-insensitive hex; every other family (Stellar G…/C…,
  // Solana base58) is case-sensitive and must be returned untouched.
  if (family === "stellar" || family === "solana") return trimmed;
  return trimmed.toLowerCase();
}

// ─── Placeholder sentinel ────────────────────────────────────────────────────

/**
 * The "unset" address sentinel for a chain family.
 *
 * For EVM this is the historical 0x000…000 zero-address.
 * For Stellar there is no canonical zero-address; we use the empty string.
 * Callers that previously compared against `ZERO_ADDRESS` for EVM should
 * switch to `isUnsetAddress(value, family)` to remain family-agnostic.
 */
export function unsetAddressForFamily(family: ChainFamily): string {
  switch (family) {
    case "evm":
      return "0x0000000000000000000000000000000000000000";
    case "stellar":
    case "solana":
      return "";
  }
}

/**
 * Returns true if the given address is the unset/placeholder sentinel for
 * the given family.
 */
export function isUnsetAddress(value: string | null | undefined, family: ChainFamily): boolean {
  if (value == null) return true;
  return value === unsetAddressForFamily(family);
}

/**
 * Family-aware unset-address check keyed by chainId.
 */
export function isUnsetAddressForChain(
  value: string | null | undefined,
  chainId: number,
): boolean {
  const family = getChainFamily(chainId);
  if (!family) return value == null || value === "";
  return isUnsetAddress(value, family);
}