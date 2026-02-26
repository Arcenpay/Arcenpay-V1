"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        className="btn"
        onClick={() => disconnect()}
        title={address}
        style={{ width: "100%", justifyContent: "center" }}
      >
        {address.slice(0, 6)}...{address.slice(-4)}
      </button>
    );
  }

  return (
    <button
      className="btn btn-primary"
      onClick={() => connect({ connector: injected() })}
      style={{ width: "100%", justifyContent: "center" }}
    >
      Connect Wallet
    </button>
  );
}
