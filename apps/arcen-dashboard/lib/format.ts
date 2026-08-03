// ============================================================
//  Dashboard — Shared formatting utilities
// ============================================================

/** Format a raw USDC bigint (6 decimals) → "$12.34" */
export function formatUsdc(amount: bigint | number | string): string {
  const n = typeof amount === "bigint" ? Number(amount) : Number(amount);
  const dollars = n / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

/** Truncate an Ethereum address: "0x1234...5678" */
export function truncateAddress(address: string, start = 6, end = 4): string {
  if (!address || address.length < start + end + 2) return address;
  return `${address.slice(0, start)}…${address.slice(-end)}`;
}

/** Format a Unix timestamp (seconds) to a relative string like "3 hours ago" */
export function formatRelativeTime(unixSeconds: number | bigint): string {
  const ts =
    typeof unixSeconds === "bigint" ? Number(unixSeconds) : unixSeconds;
  const now = Date.now() / 1000;
  const diff = now - ts;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a Unix timestamp to an absolute date string for tooltip/hover */
export function formatAbsoluteTime(unixSeconds: number | bigint): string {
  const ts =
    typeof unixSeconds === "bigint" ? Number(unixSeconds) : unixSeconds;
  return new Date(ts * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Return a block explorer URL for a transaction, address, or block */
export function getBlockExplorerUrl(
  chainId: number,
  type: "tx" | "address" | "block",
  hash: string,
): string {
  // Stellar chains use stellar.expert
  const STELLAR_NETWORK: Record<number, string> = {
    9000000: "public",
    9000001: "testnet",
    9000002: "futurenet",
  };
  if (STELLAR_NETWORK[chainId]) {
    const network = STELLAR_NETWORK[chainId];
    const stellarType = type === "address" ? "account" : type;
    return `https://stellar.expert/explorer/${network}/${stellarType}/${hash}`;
  }

  const BASE_URLS: Record<number, string> = {
    1: "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    8453: "https://basescan.org",
    84532: "https://sepolia.basescan.org",
    5042002: "https://testnet.arcscan.app",
  };
  const base = BASE_URLS[chainId] ?? "https://sepolia.etherscan.io";
  return `${base}/${type}/${hash}`;
}

/** Returns the block explorer base URL for the given chain */
export function getBlockExplorerBase(chainId: number): string {
  const STELLAR_NETWORK: Record<number, string> = {
    9000000: "public",
    9000001: "testnet",
    9000002: "futurenet",
  };
  if (STELLAR_NETWORK[chainId]) {
    return `https://stellar.expert/explorer/${STELLAR_NETWORK[chainId]}`;
  }

  const BASE_URLS: Record<number, string> = {
    1: "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    8453: "https://basescan.org",
    84532: "https://sepolia.basescan.org",
    5042002: "https://testnet.arcscan.app",
  };
  return BASE_URLS[chainId] ?? "https://sepolia.etherscan.io";
}

/** Shorten a transaction hash: "0x1234…5678" */
export function shortHash(hash: string): string {
  if (!hash || hash.length < 12) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

/** Convert seconds to human-readable interval: 2592000 → "Monthly" */
export function formatInterval(seconds: number | bigint): string {
  const s = typeof seconds === "bigint" ? Number(seconds) : seconds;
  if (s === 2592000) return "Monthly";
  if (s === 7776000) return "Quarterly";
  if (s === 31536000) return "Annual";
  const days = Math.round(s / 86400);
  return `Every ${days}d`;
}
