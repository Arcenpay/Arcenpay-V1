"use client";

import styles from "./layout.module.css";
import { useWallet } from "./useWallet";

export default function WalletChip() {
  const { address, connecting, available, connect, disconnect, shortAddr } = useWallet();

  if (!available) return null;

  if (address) {
    return (
      <div className={styles.walletChip} onClick={disconnect} title="Click to disconnect">
        <div className={styles.walletDot} style={{ background: "#16a34a" }} />
        <span className={styles.walletAddr}>{shortAddr}</span>
      </div>
    );
  }

  return (
    <div className={styles.walletChip} onClick={connect} style={{ cursor: "pointer" }} title="Connect wallet">
      <div className={styles.walletDot} style={{ background: connecting ? "#f59e0b" : "#9ca3af" }} />
      <span className={styles.walletAddr}>{connecting ? "Connecting…" : "Connect Wallet"}</span>
    </div>
  );
}
