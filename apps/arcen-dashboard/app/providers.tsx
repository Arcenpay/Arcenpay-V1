"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";

// The EVM/Solana wallet stack (Reown AppKit, WalletConnect, wagmi, Apollo and
// the Solana adapters) is large and browser-only. Loading it with `ssr: false`
// keeps the whole graph out of the server bundle, so it is never evaluated in
// the Cloudflare Worker's global scope on cold start. That cold-start module
// initialisation is what exceeds the Worker resource limit (Error 1102).
const Web3Provider = dynamic(
  () =>
    import("@/components/providers/web3-provider").then(
      (mod) => mod.Web3Provider,
    ),
  { ssr: false },
);

export function Web3Providers({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  return <Web3Provider cookies={cookies}>{children}</Web3Provider>;
}
