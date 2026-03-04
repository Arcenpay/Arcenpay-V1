"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { buildSIWEMessage } from "@/lib/auth";
import { Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = async () => {
    if (!address || !isConnected) {
      toast.error("Connect your wallet first");
      return;
    }

    setIsSigningIn(true);
    try {
      // 1. Fetch nonce
      const nonceRes = await fetch("/api/auth/nonce");
      const { nonce, issuedAt } = await nonceRes.json();

      // 2. Build SIWE message
      const message = buildSIWEMessage({
        address,
        chainId,
        nonce,
        domain: typeof window !== "undefined" ? window.location.host : "arcenpay.xyz",
        uri: typeof window !== "undefined" ? window.location.origin : "https://arcenpay.xyz",
        issuedAt,
      });

      // 3. Request signature from wallet
      const signature = await signMessageAsync({ message });

      // 4. Verify with server
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, address, chainId, nonce }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.error || "Verification failed");
      }

      toast.success("Signed in successfully");
      router.push(callbackUrl);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      if (msg.includes("rejected") || msg.includes("denied")) {
        toast.error("Signature rejected");
      } else {
        toast.error(msg);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Logo / Brand */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Shield className="w-7 h-7 text-accent" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">ArcenPay</h1>
            <p className="text-sm text-muted-foreground mt-1">Provider Dashboard</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
          <div className="space-y-1 text-center">
            <h2 className="text-lg font-semibold text-foreground">Sign In</h2>
            <p className="text-sm text-muted-foreground">
              Connect your wallet and sign a message to authenticate
            </p>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            {[
              { num: 1, label: "Connect Wallet", done: isConnected },
              { num: 2, label: "Sign SIWE Message", done: false },
            ].map((step) => (
              <div
                key={step.num}
                className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40 border border-border"
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                    step.done
                      ? "bg-success/15 text-success border border-success/30"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {step.num}
                </div>
                <span className={`text-sm ${step.done ? "text-foreground" : "text-muted-foreground"}`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>

          {/* Action */}
          <div className="space-y-3">
            {!isConnected ? (
              <div className="flex justify-center">
                <ConnectButton />
              </div>
            ) : (
              <Button
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleSignIn}
                disabled={isSigningIn}
              >
                {isSigningIn ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Signing…
                  </>
                ) : (
                  "Sign In with Ethereum"
                )}
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            This only signs a message — no transaction or gas required.
            <br />
            Your session expires in 24 hours.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginForm />
    </Suspense>
  );
}
