"use client";

import { useAccount, useSignMessage, useChainId } from "wagmi";
import { useState, useCallback } from "react";
import { ConnectButton } from "@/components/ConnectButton";

export default function LoginPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);

    try {
      const nonceRes = await fetch("/api/auth/nonce");
      const { nonce } = await nonceRes.json();

      const message = [
        `${window.location.host} wants you to sign in with your Ethereum account:`,
        address,
        "",
        "Sign in to ArcenPay Provider Dashboard",
        "",
        `URI: ${window.location.origin}`,
        `Version: 1`,
        `Chain ID: ${chainId}`,
        `Nonce: ${nonce}`,
        `Issued At: ${new Date().toISOString()}`,
      ].join("\n");

      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });

      const result = await verifyRes.json();
      if (result.ok) {
        window.location.href = "/";
      } else {
        setError(result.error || "Verification failed");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("User rejected")) {
        setError("Signature rejected");
      } else {
        setError(err instanceof Error ? err.message : "Sign-in failed");
      }
    } finally {
      setLoading(false);
    }
  }, [address, chainId, signMessageAsync]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg-primary)",
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 40,
          width: 420,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>⬡</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
          ArcenPay
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 14,
            marginBottom: 32,
          }}
        >
          Connect your wallet to access the Provider Dashboard
        </p>

        {!isConnected ? (
          <div style={{ maxWidth: 200, margin: "0 auto" }}>
            <ConnectButton />
          </div>
        ) : (
          <div>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                marginBottom: 16,
              }}
            >
              Connected as{" "}
              <span className="address">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
            </p>
            <button
              className="btn btn-primary"
              onClick={handleSignIn}
              disabled={loading}
              style={{ padding: "10px 24px" }}
            >
              {loading ? "Signing..." : "Sign In with Ethereum"}
            </button>
          </div>
        )}

        {error && (
          <p
            style={{
              color: "var(--danger)",
              fontSize: 13,
              marginTop: 16,
            }}
          >
            {error}
          </p>
        )}

        <div
          style={{
            marginTop: 32,
            paddingTop: 20,
            borderTop: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          MEAP + ZKVUB Protocol — Sepolia Testnet
        </div>
      </div>
    </div>
  );
}
