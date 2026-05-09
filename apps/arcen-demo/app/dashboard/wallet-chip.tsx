"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import styles from "./layout.module.css";

export default function WalletChip() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openConnectModal,
        openAccountModal,
        mounted,
      }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <div
            className={styles.walletChip}
            onClick={connected ? openAccountModal : openConnectModal}
            style={{ cursor: "pointer" }}
            title={
              connected
                ? `Connected: ${account.displayName}`
                : "Connect wallet"
            }
          >
            <div
              className={styles.walletDot}
              style={{
                background: connected ? "#16a34a" : "#9ca3af",
              }}
            />
            <span className={styles.walletAddr}>
              {connected
                ? `${account.address.slice(0, 6)}\u2026${account.address.slice(-4)}`
                : "Connect Wallet"}
            </span>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
