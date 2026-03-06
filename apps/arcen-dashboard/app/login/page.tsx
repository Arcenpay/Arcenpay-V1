"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { buildSIWEMessage } from "@/lib/auth";
import {
  Loader2,
  Shield,
  Mail,
  Wallet,
  CheckCircle,
  ArrowRight,
  Zap,
  ChevronRight,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// ── Error messages from magic-link verify redirect ────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: "The sign-in link is missing. Please request a new one.",
  invalid_token: "This sign-in link is invalid or has already been used.",
  token_used:
    "This sign-in link has already been used. Please request a new one.",
  token_expired: "This sign-in link has expired. Please request a new one.",
  email_taken:
    "That email is already linked to another account. Use a different address.",
  server_error: "Something went wrong. Please try again.",
};

type Step = "wallet" | "add-email" | "email-sent";

// ── Login form ─────────────────────────────────────────────────────────────────

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const errorCode = searchParams.get("error");
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] : null;

  // Step state
  const [step, setStep] = useState<Step>("wallet");

  // Wallet state
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { open } = useAppKit();
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Email state
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);

  // ── Step 1: Wallet sign-in ────────────────────────────────────────────────
  const handleWalletSignIn = async () => {
    if (!address || !isConnected) {
      toast.error("Connect your wallet first");
      return;
    }

    setIsSigningIn(true);
    try {
      const nonceRes = await fetch("/api/auth/nonce");
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

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, address, chainId, nonce }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.error || "Verification failed");
      }

      const data = await verifyRes.json();

      if (data.needsEmail) {
        // Step 2 — must add email
        setStep("add-email");
      } else {
        // Already has email — go straight to dashboard
        toast.success("Signed in successfully");
        router.push(callbackUrl);
        router.refresh();
      }
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

  // ── Step 2: Email request ─────────────────────────────────────────────────
  const handleEmailRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSending(true);
    try {
      const res = await fetch("/api/auth/magic/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }

      setStep("email-sent");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send link");
    } finally {
      setIsSending(false);
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
              ArcenPay
            </h1>
            <p className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Provider Dashboard
            </p>
          </div>
        </div>

        {/* Error banner */}
        {errorMessage && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive">{errorMessage}</p>
          </div>
        )}

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {(["wallet", "add-email"] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors ${
                  step === s
                    ? "bg-accent text-accent-foreground"
                    : step === "email-sent" || (s === "wallet" && step === "add-email")
                    ? "bg-success/15 text-success border border-success/30"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {(step === "email-sent" && s === "add-email") ||
                (s === "wallet" && (step === "add-email" || step === "email-sent")) ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-xs font-medium flex-1 ${
                  step === s ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {s === "wallet" ? "Connect Wallet" : "Add Email"}
              </span>
              {i < 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">

          {/* ── Step 1: Wallet ──────────────────────────────────────────────── */}
          {step === "wallet" && (
            <>
              <div className="px-6 pt-6 pb-4 border-b border-border/60">
                <h2 className="text-lg font-semibold text-foreground">
                  Connect your wallet
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Sign in with your wallet to verify ownership
                </p>
              </div>

              <div className="p-6 space-y-4">
                {isConnected ? (
                  <div className="space-y-3">
                    {/* Wallet display */}
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
                      onClick={handleWalletSignIn}
                      disabled={isSigningIn}
                    >
                      {isSigningIn ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Signing message…
                        </>
                      ) : (
                        <>
                          <Shield className="w-4 h-4 mr-2" />
                          Sign in with Wallet
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      Signs a message only — no transaction or gas required
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl bg-secondary/30 border border-border/60 text-sm text-muted-foreground">
                      Connect your Web3 wallet (MetaMask, WalletConnect, Coinbase
                      Wallet…) to identify yourself on-chain.
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
            </>
          )}

          {/* ── Step 2: Add email ────────────────────────────────────────────── */}
          {step === "add-email" && (
            <>
              <div className="px-6 pt-6 pb-4 border-b border-border/60">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-success/10 border border-success/20 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle className="w-4 h-4 text-success" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      Wallet verified
                    </h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Now add your email — required for billing alerts,
                      subscription events, and team invites
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6">
                <form onSubmit={handleEmailRequest} className="space-y-4">
                  <div className="space-y-2">
                    <label
                      htmlFor="email"
                      className="text-sm font-medium text-foreground"
                    >
                      Email address
                    </label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      autoFocus
                      className="bg-secondary/60 border-border focus:border-accent"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                    disabled={isSending || !email}
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Mail className="w-4 h-4 mr-2" />
                        Send Verification Link
                        <ArrowRight className="w-4 h-4 ml-auto" />
                      </>
                    )}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    We&apos;ll send a one-time link to verify your email.
                    <br />
                    No password needed — expires in 15 minutes.
                  </p>
                </form>
              </div>
            </>
          )}

          {/* ── Step 3: Email sent ───────────────────────────────────────────── */}
          {step === "email-sent" && (
            <div className="p-6 flex flex-col items-center gap-5 py-8">
              <div className="w-14 h-14 rounded-full bg-success/10 border border-success/20 flex items-center justify-center">
                <CheckCircle className="w-7 h-7 text-success" />
              </div>

              <div className="text-center space-y-1.5">
                <h2 className="text-lg font-semibold text-foreground">
                  Check your inbox
                </h2>
                <p className="text-sm text-muted-foreground">
                  We sent a sign-in link to{" "}
                  <span className="text-foreground font-medium">{email}</span>.
                  <br />
                  Click the link to complete sign-in. It expires in 15 minutes.
                </p>
              </div>

              <div className="w-full space-y-2 pt-2">
                <div className="p-3 rounded-xl bg-secondary/30 border border-border/60 text-xs text-muted-foreground text-center">
                  Keep this tab open — you&apos;ll be redirected automatically
                  after clicking the link in your email.
                </div>
                <button
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                  onClick={() => {
                    setStep("add-email");
                    setEmail("");
                  }}
                >
                  Use a different email address
                </button>
              </div>
            </div>
          )}

          {/* Card footer */}
          <div className="px-6 py-3.5 border-t border-border/60 bg-secondary/20">
            <p className="text-xs text-muted-foreground text-center">
              Both wallet and email are required for full access.
              <br />
              Sessions expire in 24 hours.
            </p>
          </div>
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
