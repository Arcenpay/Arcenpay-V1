"use client";

import { cn } from "@/lib/utils";
import { NetworkIcon, TokenIcon } from "@web3icons/react/dynamic";
import { Network, Coins } from "lucide-react";

// ── Chain ID → web3icons network mapping ─────────────────────────────────
//
// Stellar synthetic chainIds (9_000_000 / 9_000_001 / 9_000_002) come from
// packages/internal-core/src/chain-family.ts. They have no EVM equivalent
// so we map them to the web3icons "stellar" sprite directly.

const chainIdToNetworkName: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  84532: "base-sepolia",
  11155111: "sepolia",
  5042002: "Arc",
  9000000: "stellar", // STELLAR_MAINNET_CHAIN_ID
  9000001: "stellar", // STELLAR_TESTNET_CHAIN_ID
  9000002: "stellar", // STELLAR_FUTURENET_CHAIN_ID
};

const chainLabelToNetworkName: Record<string, string> = {
  Base: "base",
  "Base Sepolia": "base-sepolia",
  Sepolia: "sepolia",
  "Arc Testnet": "Arc",
  Ethereum: "ethereum",
  Stellar: "stellar",
  "Stellar Testnet": "stellar",
  "Stellar Futurenet": "stellar",
};

// ── Public component ──────────────────────────────────────────────────────

interface Web3IconProps {
  /** Chain ID (e.g. 8453 for Base) */
  chainId?: number;
  /** Chain label (e.g. "Base Sepolia") — alternative to chainId */
  chainLabel?: string;
  /** Token symbol (e.g. "USDC") */
  token?: string;
  /** Size class — defaults to w-5 h-5 */
  size?: "sm" | "md" | "lg";
  /** Custom class */
  className?: string;
}

const sizeMap = {
  sm: 16,
  md: 20,
  lg: 24,
};

export function Web3Icon({
  chainId,
  chainLabel,
  token,
  size = "md",
  className,
}: Web3IconProps) {
  const iconSize = sizeMap[size] ?? 20;

  // ── Token icon ──────────────────────────────────────────────────────
  if (token) {
    return (
      <span
        className={cn(
          "shrink-0 inline-flex items-center justify-center rounded-full bg-white dark:bg-white p-px",
          className,
        )}
      >
        <TokenIcon
          symbol={token.toUpperCase()}
          variant="branded"
          size={iconSize}
          className="shrink-0"
          fallback={
            <div className="shrink-0 rounded-full bg-accent/10 flex items-center justify-center w-full h-full">
              <Coins className="w-3 h-3 text-accent" />
            </div>
          }
        />
      </span>
    );
  }

  // ── Chain icon ──────────────────────────────────────────────────────
  const resolvedName = chainId
    ? chainIdToNetworkName[chainId]
    : chainLabel
      ? chainLabelToNetworkName[chainLabel]
      : undefined;

  if (resolvedName) {
    return (
      <span
        className={cn(
          "shrink-0 inline-flex items-center justify-center rounded-full bg-white dark:bg-white p-px",
          className,
        )}
      >
        <NetworkIcon
          name={resolvedName}
          variant="branded"
          size={iconSize}
          className="shrink-0"
          fallback={
            <div className="shrink-0 rounded-full bg-accent/10 flex items-center justify-center w-full h-full">
              <Network className="w-3 h-3 text-accent" />
            </div>
          }
        />
      </span>
    );
  }

  // ── Fallback ────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "shrink-0 rounded-full bg-muted flex items-center justify-center",
        size === "sm" ? "w-4 h-4" : size === "lg" ? "w-6 h-6" : "w-5 h-5",
        className,
      )}
    >
      <Network className="w-3 h-3 text-muted-foreground" />
    </div>
  );
}
