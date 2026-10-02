"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Connected Solana wallet balance (SOL) — the WalletConnect-style "wallet info"
 * line shown under the connection details in the wallet menu.
 */
export function SolanaWalletBalance() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!connected || !publicKey) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    connection
      .getBalance(publicKey)
      .then((lamports) => {
        if (!cancelled) setBalance(lamports / LAMPORTS_PER_SOL);
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, connected]);

  if (!connected || balance === null) return null;

  return (
    <p className="mt-1 font-mono text-xs text-muted-foreground">
      {balance.toFixed(4)} SOL
    </p>
  );
}
