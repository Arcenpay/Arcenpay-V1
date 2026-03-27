"use client";

import type { ReactNode } from "react";

// The demo app uses ArcenEmbed for display only — no on-chain wallet needed.
// ArcenPayProvider (wagmi/MetaMask) is intentionally excluded to avoid
// bundling heavy Web3 dependencies that aren't required for the embed flow.
export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
