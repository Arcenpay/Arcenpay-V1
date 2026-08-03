"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { ArrowLeft, CheckCircle2, Loader2, Mail, Wallet, Shield, AlertTriangle, ExternalLink, ArrowRight, Star } from "lucide-react";
import { NetworkIcon } from "@web3icons/react/dynamic";
import { CanvasRevealEffect } from "@/components/ui/canvas-reveal-effect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildSIWEMessage } from "@/lib/auth";
import {
  DEFAULT_WALLET_CHAIN_LABEL,
  SUPPORTED_WALLET_CHAIN_LABEL,
  useDashboardWallet,
} from "@/hooks/use-dashboard-wallet";
import { useStellarWallet } from "@/hooks/use-stellar-wallet";
import {
  getOnboardingChainFamily,
  setOnboardingChainFamily,
} from "@/lib/onboarding-chain-family";
import type { ChainFamily } from "@arcenpay/internal-core";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

type EmailAuthFlowProps = {
  inviteToken?: string | null;
};

type Step = "chain" | "wallet" | "email" | "code" | "sign";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function stellarShortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

function formatTimer(targetIso: string | null): string {
  if (!targetIso) return "00:30";
  const diffMs = Math.max(0, new Date(targetIso).getTime() - Date.now());
  const seconds = Math.ceil(diffMs / 1000);
  const mins = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

const TESTIMONIALS = [
  {
    quote: "ArcenPay helped us move 10x faster with our billing infrastructure. While others are bogged down with payment integrations, we're shipping new features.",
    name: "Sophie Hall",
    role: "Founder, Catalog",
    company: "Web3 Design Agency",
    initials: "SH",
  },
  {
    quote: "The subscription NFT integration was seamless. We went from concept to production billing in under a week. Our users love the transparent on-chain receipts.",
    name: "Marcus Chen",
    role: "CTO, BlockForge",
    company: "DeFi Infrastructure",
    initials: "MC",
  },
  {
    quote: "Finally a billing layer that actually understands Web3. The ZK proof settlement cut our gas costs by 60% and our users never have to leave the app.",
    name: "Aisha Patel",
    role: "Head of Product, Nexus",
    company: "Gaming Studio",
    initials: "AP",
  },
];

export function EmailAuthFlow({ inviteToken }: EmailAuthFlowProps) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { isOnRequiredNetwork, isSwitchingChain, openConnectModal, reconnectWallet, switchToRequiredNetwork } =
    useDashboardWallet();
  const stellarWallet = useStellarWallet();
  const [step, setStep] = useState<Step>("chain");
  const [chainFamily, setChainFamily] = useState<ChainFamily | null>(
    () => getOnboardingChainFamily(),
  );

  const selectChainFamily = (family: ChainFamily) => {
    setOnboardingChainFamily(family);
    setChainFamily(family);
    setStep("wallet");
  };

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [timerLabel, setTimerLabel] = useState("00:30");
  const [isLinkingWallet, setIsLinkingWallet] = useState(false);
  const [isPending, startTransition] = useTransition();

  /* Rotating testimonials */
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setIsFading(true);
      window.setTimeout(() => {
        setActiveTestimonial((prev) => (prev + 1) % TESTIMONIALS.length);
        setIsFading(false);
      }, 400);
    }, 6000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!retryAt) return;
    setTimerLabel(formatTimer(retryAt));
    const interval = window.setInterval(() => {
      setTimerLabel(formatTimer(retryAt));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [retryAt]);

  const canResend = useMemo(() => {
    if (!retryAt) return true;
    return new Date(retryAt).getTime() <= Date.now();
  }, [retryAt, timerLabel]);

  const linkWalletForSession = async (): Promise<boolean> => {
    // Stellar path
    if (chainFamily === "stellar") {
      if (!stellarWallet.address || !stellarWallet.isConnected) {
        setError("Reconnect your Stellar wallet to finish signing.");
        setStep("wallet");
        return false;
      }
      setIsLinkingWallet(true);
      setError(null);
      try {
        const nonceResponse = await fetch("/api/auth/nonce");
        if (!nonceResponse.ok) throw new Error("Could not start wallet verification.");
        const noncePayload = await nonceResponse.json();
        const nonce = noncePayload?.nonce as string | undefined;
        const issuedAt = noncePayload?.issuedAt as string | undefined;
        if (!nonce || !issuedAt) throw new Error("Wallet verification challenge is invalid.");

        const message = `ArcenPay Stellar Sign-In\n\nAddress: ${stellarWallet.address}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nDomain: ${window.location.host}`;
        const { signedMessage } = await stellarWallet.signMessage(message);

        const linkResponse = await fetch("/api/auth/link-wallet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            signature: signedMessage,
            address: stellarWallet.address,
            chainId: 9000001,
            nonce,
          }),
        });
        const linkPayload = await linkResponse.json().catch(() => ({}));
        if (!linkResponse.ok) {
          if (linkResponse.status === 409 && linkPayload.maskedOwnerEmail)
            throw new Error(`This wallet is already linked (${linkPayload.maskedOwnerEmail}).`);
          throw new Error(linkPayload.error || "Could not link this wallet.");
        }
        router.push("/");
        router.refresh();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not link wallet.";
        setError(msg.toLowerCase().includes("rejected") ? "Signature cancelled." : msg);
        return false;
      } finally { setIsLinkingWallet(false); }
    }

    // EVM path (existing)
    if (!isConnected || !address) {
      setError("Reconnect your wallet to finish signing.");
      setStep("wallet");
      return false;
    }

    if (!isOnRequiredNetwork) {
      setError(
        `Switch to a supported network (${SUPPORTED_WALLET_CHAIN_LABEL}) before signing.`,
      );
      setStep("wallet");
      return false;
    }

    setIsLinkingWallet(true);
    setError(null);
    try {
      const nonceResponse = await fetch("/api/auth/nonce");
      if (!nonceResponse.ok) {
        throw new Error("Could not start wallet verification.");
      }

      const noncePayload = await nonceResponse.json();
      const nonce = noncePayload?.nonce as string | undefined;
      const issuedAt = noncePayload?.issuedAt as string | undefined;
      if (!nonce || !issuedAt) {
        throw new Error("Wallet verification challenge is invalid.");
      }

      const message = buildSIWEMessage({
        address,
        chainId,
        nonce,
        domain: window.location.host,
        uri: window.location.origin,
        issuedAt,
      });

      const signature = await signMessageAsync({ message });
      const linkResponse = await fetch("/api/auth/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          signature,
          address,
          chainId,
          nonce,
        }),
      });

      const linkPayload = await linkResponse.json().catch(() => ({}));
      if (!linkResponse.ok) {
        if (linkResponse.status === 409 && linkPayload.maskedOwnerEmail) {
          throw new Error(
            `This wallet is already linked to another account (${linkPayload.maskedOwnerEmail}). Please sign in with that email instead.`,
          );
        }
        throw new Error(linkPayload.error || "Could not link this wallet.");
      }

      router.push("/");
      router.refresh();
      return true;
    } catch (linkError) {
      const message =
        linkError instanceof Error ? linkError.message : "Could not link this wallet.";
      if (message.toLowerCase().includes("rejected")) {
        setError("Signature cancelled. Click Sign wallet to finish login.");
      } else {
        setError(`Wallet signing failed: ${message}`);
      }
      return false;
    } finally {
      setIsLinkingWallet(false);
    }
  };

  const submitEmail = () => {
    if (!isConnected || !address) {
      setError("Connect your wallet first.");
      setStep("wallet");
      return;
    }

    startTransition(async () => {
      setError(null);
      const response = await fetch("/api/auth/email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          walletAddress: address,
          ...(inviteToken ? { inviteToken } : {}),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && payload.ownerWallet) {
          setError(
            `This email is already linked to a different wallet. Please sign in with the wallet registered for this email.`,
          );
        } else if (response.status === 409 && payload.maskedOwnerEmail) {
          setError(
            `This wallet is already linked to another account (${payload.maskedOwnerEmail}). Please sign in with that email instead.`,
          );
        } else {
          setError(payload.error || "Could not send a verification code.");
        }
        if (payload.retryAt) setRetryAt(payload.retryAt);
        return;
      }

      setDebugCode(payload.debugCode ?? null);
      setRetryAt(payload.retryAt ?? null);
      setExpiresAt(payload.expiresAt ?? null);
      setCode("");
      setStep("code");
    });
  };

  const submitCode = () => {
    startTransition(async () => {
      setError(null);
      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          code,
          walletAddress: address || undefined,
          ...(inviteToken ? { inviteToken } : {}),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && payload.ownerWallet) {
          setError(
            `This email is already linked to a different wallet. Please sign in with the wallet registered for this email.`,
          );
        } else if (response.status === 409 && payload.maskedOwnerEmail) {
          setError(
            `This wallet is already linked to another account (${payload.maskedOwnerEmail}). Please sign in with that email instead.`,
          );
        } else {
          setError(payload.error || "Could not verify this code.");
        }
        return;
      }

      const requiresWalletLink =
        (payload.redirectTo || "/") === "/onboarding/wallet" ||
        (payload.redirectTo || "/") === "/onboarding/chain";
      if (!requiresWalletLink) {
        router.push(payload.redirectTo || "/");
        router.refresh();
        return;
      }
      setStep("sign");
      await linkWalletForSession();
    });
  };

  const testimonial = TESTIMONIALS[activeTestimonial];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row font-sans">
      {/* Left Side — Form */}
      <div className="flex-1 flex flex-col bg-background min-w-0">
        {/* Logo */}
        <div className="px-4 sm:px-8 py-4 sm:py-6 lg:px-12 lg:py-8">
          <img
            src="/arcenpay-logo.png"
            alt="ArcenPay"
            className="h-7 sm:h-8 w-auto object-contain dark:brightness-0 dark:invert"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>

        {/* Form Content */}
        <div className="flex-1 flex items-start sm:items-center justify-center px-4 sm:px-8 pb-6 sm:pb-10 lg:px-12 pt-2 sm:pt-0">
          <div className="w-full max-w-sm">
            {/* Header */}
            <div className="mb-6 sm:mb-8">
              <h1 className="text-2xl sm:text-[28px] font-semibold text-foreground tracking-tight">
                {step === "chain" && "Choose your blockchain"}
                {step === "wallet" && chainFamily === "stellar" && "Connect Stellar wallet"}
                {step === "wallet" && chainFamily !== "stellar" && "Connect your wallet"}
                {step === "email" && "Continue with email"}
                {step === "code" && "Enter verification code"}
                {step === "sign" && "Sign to finish"}
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground mt-2 sm:mt-3 leading-relaxed">
                {step === "chain" &&
                  "Select your blockchain ecosystem first. You'll connect the appropriate wallet next."}
                {step === "wallet" &&
                  `Connect a wallet on ${SUPPORTED_WALLET_CHAIN_LABEL}. After email verification, we'll request one signature and complete setup.`}
                {step === "email" &&
                  "Once your wallet is connected, we'll send a 6-digit code to your email."}
                {step === "code" &&
                  `We sent a code to ${email}. Enter it below to continue.`}
                {step === "sign" &&
                  "One signature remains to link this wallet to your account."}
              </p>
            </div>

            {inviteToken ? (
              <div className="mb-6 text-sm text-muted-foreground">
                Workspace invite detected. Use the invited email after connecting your wallet.
              </div>
            ) : null}

            {error ? (
              <div className="mb-6 text-sm text-red-600">
                {error}
              </div>
            ) : null}

            {step === "chain" ? (
              <div className="space-y-4">
                {/* EVM Card */}
                <button
                  onClick={() => selectChainFamily("evm")}
                  className="w-full flex items-center gap-4 p-5 rounded-xl border-2 border-border hover:border-brand/40 hover:bg-accent/5 transition-all text-left group"
                >
                  <div className="relative flex shrink-0" style={{ width: 56, height: 44 }}>
                    <NetworkIcon name="base" variant="branded" size={28} className="rounded-full bg-white dark:bg-white p-[2px] absolute left-0 top-0 z-20 ring-2 ring-background" />
                    <NetworkIcon name="Arc" variant="branded" size={28} className="rounded-full bg-white dark:bg-white p-[2px] absolute left-[14px] top-0 z-10 ring-2 ring-background" />
                    <NetworkIcon name="ethereum" variant="branded" size={28} className="rounded-full bg-white dark:bg-white p-[2px] absolute left-[28px] top-0 z-0 ring-2 ring-background" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground group-hover:text-brand transition-colors">EVM Networks</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Base, Arc, Ethereum — MetaMask, Rainbow, WalletConnect
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-brand transition-colors shrink-0" />
                </button>

                {/* Stellar Card */}
                <button
                  onClick={() => selectChainFamily("stellar")}
                  className="w-full flex items-center gap-4 p-5 rounded-xl border-2 border-border hover:border-brand/40 hover:bg-accent/5 transition-all text-left group"
                >
                  <div className="w-[44px] h-[44px] rounded-full bg-white dark:bg-white flex items-center justify-center shrink-0 ring-2 ring-background">
                    <NetworkIcon name="stellar" variant="branded" size={30} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground group-hover:text-brand transition-colors">Stellar Networks</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Stellar Testnet &amp; Mainnet — Freighter, xBull, LOBSTR
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-brand transition-colors shrink-0" />
                </button>
              </div>
            ) : step === "wallet" && chainFamily === "stellar" ? (
              <div className="space-y-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <NetworkIcon name="stellar" variant="branded" size={20} className="rounded-full" />
                  <span>Select a Stellar wallet to connect</span>
                </div>

                {stellarWallet.error && (
                  <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{stellarWallet.error}</div>
                )}

                {stellarWallet.address ? (
                  <>
                    <div className="p-4 rounded-xl bg-brand/5 border border-brand/20">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-brand shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">Connected</p>
                          <code className="text-xs font-mono text-muted-foreground">{stellarShortAddress(stellarWallet.address)}</code>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                      onClick={() => { setError(null); setStep("email"); }}
                    >
                      Continue
                    </Button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground rounded-lg flex items-center justify-center gap-2 font-medium disabled:opacity-60"
                    onClick={() => void stellarWallet.connect()}
                    disabled={stellarWallet.isLoading || !stellarWallet.ready}
                  >
                    {!stellarWallet.ready || stellarWallet.isLoading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />Initializing wallet kit...</>
                    ) : (
                      <><NetworkIcon name="stellar" variant="branded" size={18} className="rounded-full" />Connect Stellar wallet</>
                    )}
                  </button>
                )}

                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                    onClick={() => { setChainFamily(null); setStep("chain"); }}
                  >Back</button>
                </div>
              </div>
            ) : step === "wallet" ? (
              <div className="space-y-5">
                {/* Wallet Status */}
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div className="flex items-center gap-3">
                    <Wallet className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Wallet status</p>
                      {isConnected && address ? (
                        <p className="text-sm font-mono text-foreground">{shortAddress(address)}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Not connected</p>
                      )}
                    </div>
                  </div>
                  {isConnected && address && (
                    <CheckCircle2 className="h-5 w-5 text-brand" />
                  )}
                </div>

                <Button
                  type="button"
                  variant={isConnected ? "outline" : "default"}
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                  onClick={() => void (isConnected ? reconnectWallet() : openConnectModal())}
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  {isConnected ? "Change wallet" : "Connect wallet"}
                </Button>

                {isConnected && !isOnRequiredNetwork ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full"
                    onClick={() => void switchToRequiredNetwork()}
                    disabled={isSwitchingChain}
                  >
                    {isSwitchingChain ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Switching network
                      </>
                    ) : (
                      `Switch to ${DEFAULT_WALLET_CHAIN_LABEL}`
                    )}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                  disabled={!isConnected || !address || !isOnRequiredNetwork}
                  onClick={() => {
                    setError(null);
                    setStep("email");
                  }}
                >
                  Continue
                </Button>

                <button
                  type="button"
                  className="w-full text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 mt-3"
                  onClick={() => { setChainFamily(null); setStep("chain"); }}
                >
                  Back to chain selection
                </button>
              </div>
            ) : null}

            {step === "email" ? (
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="h-4 w-4" />
                  <span className="font-mono">{address ? shortAddress(address) : "Not connected"}</span>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Work email
                  </label>
                  <Input
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-12 bg-background"
                  />
                </div>

                <Button
                  type="button"
                  onClick={submitEmail}
                  disabled={isPending || isLinkingWallet || !email.trim()}
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending code
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Send verification code
                    </>
                  )}
                </Button>

                {debugCode ? (
                  <div className="text-sm text-muted-foreground">
                    Dev code: <span className="font-mono font-semibold">{debugCode}</span>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep("wallet");
                  }}
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to wallet step
                </button>
              </div>
            ) : null}

            {step === "code" ? (
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="h-4 w-4" />
                  <span className="font-mono">{address ? shortAddress(address) : "Not connected"}</span>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">
                    Verification code
                  </label>
                  <InputOTP
                    maxLength={6}
                    value={code}
                    onChange={setCode}
                    containerClassName="justify-start"
                    className="w-full"
                  >
                    <InputOTPGroup className="gap-1.5 sm:gap-2">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <InputOTPSlot
                          key={index}
                          index={index}
                          className="h-10 w-10 sm:h-12 sm:w-12 rounded-md border text-sm sm:text-base"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                  {expiresAt ? (
                    <p className="text-xs text-muted-foreground">
                      Code expires at {new Date(expiresAt).toLocaleTimeString()}.
                    </p>
                  ) : null}
                  {debugCode ? (
                    <p className="text-xs text-muted-foreground">
                      Dev fallback code: <span className="font-mono">{debugCode}</span>
                    </p>
                  ) : null}
                </div>

                <Button
                  type="button"
                  onClick={submitCode}
                  disabled={isPending || isLinkingWallet || code.length !== 6}
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying
                    </>
                  ) : (
                    "Verify and continue"
                  )}
                </Button>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setCode("");
                      setStep("email");
                    }}
                    className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Change email
                  </button>

                  <button
                    type="button"
                    disabled={!canResend || isPending || isLinkingWallet}
                    onClick={submitEmail}
                    className="text-sm font-medium text-brand disabled:text-muted-foreground"
                  >
                    {canResend ? "Resend code" : `Resend in ${timerLabel}`}
                  </button>
                </div>
              </div>
            ) : null}

            {step === "sign" ? (
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="h-4 w-4" />
                  <span className="font-mono">{address ? shortAddress(address) : "Not connected"}</span>
                </div>

                <Button
                  type="button"
                  variant={isConnected ? "outline" : "default"}
                  className="h-12 w-full"
                  onClick={() => void (isConnected ? reconnectWallet() : openConnectModal())}
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  {isConnected ? "Change wallet" : "Connect wallet"}
                </Button>

                {isConnected && !isOnRequiredNetwork ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full"
                    onClick={() => void switchToRequiredNetwork()}
                    disabled={isSwitchingChain}
                  >
                    {isSwitchingChain ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Switching network
                      </>
                    ) : (
                      `Switch to ${DEFAULT_WALLET_CHAIN_LABEL}`
                    )}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  onClick={() => {
                    void linkWalletForSession();
                  }}
                  disabled={
                    isLinkingWallet || !isConnected || !address || !isOnRequiredNetwork
                  }
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                >
                  {isLinkingWallet ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing wallet
                    </>
                  ) : (
                    <>
                      <Shield className="mr-2 h-4 w-4" />
                      Sign wallet and continue
                    </>
                  )}
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep("code");
                  }}
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to code
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Right Side — Canvas Reveal Effect + Auto-rotating Testimonials */}
      <div className="hidden lg:flex lg:w-1/2 text-gray-900 relative overflow-hidden">
        {/* Dot-matrix reveal background */}
        <div className="absolute inset-0">
          <CanvasRevealEffect
            opacities={[0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1]}
            colors={[[0, 0, 253], [147, 51, 234], [6, 182, 212]]} // brand #0000FD, purple-600, cyan-500
            dotSize={3}
            showGradient={true}
            containerClassName="h-full w-full"
          />
        </div>
        
        {/* Content */}
        <div className="relative z-10 flex flex-col justify-end p-12">
          {/* Stars */}
          <div className="flex items-center gap-1 mb-6">
            {[1,2,3,4,5].map((i) => (
              <Star key={i} className="w-4 h-4 fill-gray-900 text-gray-900" />
            ))}
          </div>

          {/* Auto-rotating testimonial with fade */}
          <div className={`transition-opacity duration-400 ${isFading ? "opacity-0" : "opacity-100"}`}>
            <blockquote className="text-2xl font-medium leading-relaxed mb-8 max-w-md">
              {testimonial.quote}
            </blockquote>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-brand flex items-center justify-center">
                <span className="text-sm font-semibold text-primary-foreground">{testimonial.initials}</span>
              </div>
              <div>
                <p className="font-semibold">{testimonial.name}</p>
                <p className="text-sm text-gray-900/60">{testimonial.role}</p>
                <p className="text-sm text-gray-900/40">{testimonial.company}</p>
              </div>
            </div>
          </div>

          {/* Pagination dots */}
          <div className="flex items-center gap-2 mt-8">
            {TESTIMONIALS.map((_, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setIsFading(true);
                  window.setTimeout(() => {
                    setActiveTestimonial(idx);
                    setIsFading(false);
                  }, 400);
                }}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx === activeTestimonial ? "w-6 bg-gray-900" : "w-1.5 bg-gray-900/30"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
