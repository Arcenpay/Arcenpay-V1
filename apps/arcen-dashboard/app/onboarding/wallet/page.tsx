"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { buildSIWEMessage } from "@/lib/auth";
import { Loader2, Shield, Wallet, CheckCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ConnectWalletPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { open } = useAppKit();
  const [isSigning, setIsSigning] = useState(false);

  const handleLinkWallet = async () => {
    if (!address || !isConnected) {
      toast.error("Connect your wallet first");
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
        throw new Error(err.error || "Wallet link failed");
      }

      toast.success("Wallet connected");
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      if (msg.includes("rejected") || msg.includes("denied")) {
        toast.error("Signature rejected");
      } else {
        toast.error(msg);
      }
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Shield className="w-8 h-8 text-accent" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
              <Zap className="w-2.5 h-2.5 text-accent-foreground" />
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Connect your wallet
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              One-time setup — link your on-chain identity to your account
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b border-border/60">
            <h2 className="text-lg font-semibold text-foreground">
              Verify wallet ownership
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Sign a message to prove you own this wallet. No transaction or gas
              required.
            </p>
          </div>

          <div className="p-6 space-y-4">
            {isConnected ? (
              <div className="space-y-3">
                {/* Connected wallet display */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-secondary/40 border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-success/10 border border-success/20 flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-success" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Connected wallet
                      </p>
                      <code className="text-sm font-mono text-foreground">
                        {address?.slice(0, 6)}…{address?.slice(-4)}
                      </code>
                    </div>
                  </div>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => open()}
                  >
                    Change
                  </button>
                </div>

                <Button
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={handleLinkWallet}
                  disabled={isSigning}
                >
                  {isSigning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Signing message…
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4 mr-2" />
                      Sign &amp; Continue
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-secondary/30 border border-border/60 text-sm text-muted-foreground">
                  Connect your Web3 wallet (MetaMask, WalletConnect, Coinbase
                  Wallet…) to link it with your ArcenPay account.
                </div>
                <Button
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={() => open()}
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  Connect Wallet
                </Button>
              </div>
            )}
          </div>

          <div className="px-6 py-3.5 border-t border-border/60 bg-secondary/20">
            <p className="text-xs text-muted-foreground text-center">
              Your wallet is required to interact with on-chain subscriptions.
              <br />
              This is a one-time setup step.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
