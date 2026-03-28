"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { buildSIWEMessage } from "@/lib/auth";
import { Loader2, Shield, Wallet, CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ConnectWalletPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { open } = useAppKit();
  const [isSigning, setIsSigning] = useState(false);
  const [storedWallet, setStoredWallet] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/auth/wallet-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStoredWallet(d?.storedWallet ?? null))
      .catch(() => setStoredWallet(null));
  }, []);

  const handleLinkWallet = async () => {
    if (!address || !isConnected) {
      toast.error("Connect a wallet first");
      return;
    }

    setIsSigning(true);
    try {
      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("Failed to get nonce");
      const { nonce, issuedAt } = await nonceRes.json();

      const message = buildSIWEMessage({
        address,
        chainId,
        nonce,
        domain: window.location.host,
        uri: window.location.origin,
        issuedAt,
      });

      const signature = await signMessageAsync({ message });

      const res = await fetch("/api/auth/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, address, chainId, nonce }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to link wallet");
      }

      toast.success("Wallet linked");
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (msg.includes("rejected") || msg.includes("denied")) {
        toast.error("Signature cancelled");
      } else {
        toast.error(msg);
      }
    } finally {
      setIsSigning(false);
    }
  };

  // Loading
  if (storedWallet === undefined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Already linked — info screen
  if (storedWallet) {
    const isMatch = address && address.toLowerCase() === storedWallet.toLowerCase();

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Wallet linked</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Your provider identity is set up.</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Provider wallet</p>
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-secondary/50 border border-border">
                <Shield className="w-3.5 h-3.5 text-green-500 shrink-0" />
                <code className="text-sm font-mono text-foreground">
                  {storedWallet.slice(0, 6)}…{storedWallet.slice(-4)}
                </code>
              </div>
            </div>

            {isConnected && address ? (
              isMatch ? (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Matches connected wallet
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2 text-sm text-amber-600">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Different wallet connected.{" "}
                      <span className="text-muted-foreground">
                        Switch to{" "}
                        <code className="font-mono text-xs">
                          {storedWallet.slice(0, 6)}…{storedWallet.slice(-4)}
                        </code>{" "}
                        for on-chain operations.
                      </span>
                    </span>
                  </div>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => open()}>
                    <Wallet className="w-3.5 h-3.5 mr-2" />
                    Switch wallet
                  </Button>
                </div>
              )
            ) : (
              <div className="space-y-2.5">
                <p className="text-sm text-muted-foreground">
                  Connect your provider wallet to perform on-chain operations.
                </p>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => open()}
                >
                  <Wallet className="w-3.5 h-3.5 mr-2" />
                  Connect wallet
                </Button>
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => router.push("/")}
          >
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  // Setup flow
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-primary/5 border border-border flex items-center justify-center">
            <Wallet className="w-6 h-6 text-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Link your wallet</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Required before you can access the dashboard
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-5 space-y-4">
            {/* Steps */}
            <div className="flex items-center gap-0 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-medium text-[10px]">1</span>
                Connect
              </span>
              <div className="flex-1 h-px bg-border mx-2" />
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-secondary border border-border text-muted-foreground flex items-center justify-center font-medium text-[10px]">2</span>
                Sign
              </span>
              <div className="flex-1 h-px bg-border mx-2" />
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-secondary border border-border text-muted-foreground flex items-center justify-center font-medium text-[10px]">3</span>
                Done
              </span>
            </div>

            <div className="h-px bg-border" />

            {isConnected && address ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-secondary/50 border border-border">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <code className="text-sm font-mono text-foreground">
                      {address.slice(0, 6)}…{address.slice(-4)}
                    </code>
                  </div>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => open()}
                  >
                    Change
                  </button>
                </div>

                <Button
                  className="w-full"
                  onClick={handleLinkWallet}
                  disabled={isSigning}
                >
                  {isSigning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Waiting for signature…
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4 mr-2" />
                      Sign &amp; link wallet
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Connect MetaMask, WalletConnect, Coinbase Wallet, or any EVM wallet.
                </p>
                <Button className="w-full" onClick={() => open()}>
                  <Wallet className="w-4 h-4 mr-2" />
                  Connect wallet
                </Button>
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-border bg-secondary/20">
            <p className="text-xs text-muted-foreground">
              No transaction or gas required. Signing is free and only proves ownership.
            </p>
          </div>
        </div>

        {/* Note */}
        <p className="text-xs text-center text-muted-foreground/60 leading-relaxed">
          This wallet becomes your permanent provider identity on-chain.<br />
          Use the same wallet across all devices.
        </p>
      </div>
    </div>
  );
}
