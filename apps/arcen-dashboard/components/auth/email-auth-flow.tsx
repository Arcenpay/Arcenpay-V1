"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { ArrowLeft, CheckCircle2, Loader2, Mail, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildSIWEMessage } from "@/lib/auth";
import {
  REQUIRED_WALLET_CHAIN_LABEL,
  useDashboardWallet,
} from "@/hooks/use-dashboard-wallet";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

type EmailAuthFlowProps = {
  inviteToken?: string | null;
};

type Step = "wallet" | "email" | "code" | "sign";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimer(targetIso: string | null): string {
  if (!targetIso) return "00:30";
  const diffMs = Math.max(0, new Date(targetIso).getTime() - Date.now());
  const seconds = Math.ceil(diffMs / 1000);
  const mins = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function EmailAuthFlow({ inviteToken }: EmailAuthFlowProps) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { isOnRequiredNetwork, isSwitchingChain, openConnectModal, reconnectWallet, switchToRequiredNetwork } =
    useDashboardWallet();
  const [step, setStep] = useState<Step>("wallet");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [timerLabel, setTimerLabel] = useState("00:30");
  const [isLinkingWallet, setIsLinkingWallet] = useState(false);
  const [isPending, startTransition] = useTransition();

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
    if (!isConnected || !address) {
      setError("Reconnect your wallet to finish signing.");
      setStep("wallet");
      return false;
    }

    if (!isOnRequiredNetwork) {
      setError(`Switch to ${REQUIRED_WALLET_CHAIN_LABEL} before signing.`);
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
        if (response.status === 409 && payload.maskedOwnerEmail) {
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
        if (response.status === 409 && payload.maskedOwnerEmail) {
          setError(
            `This wallet is already linked to another account (${payload.maskedOwnerEmail}). Please sign in with that email instead.`,
          );
        } else {
          setError(payload.error || "Could not verify this code.");
        }
        return;
      }

      const requiresWalletLink = (payload.redirectTo || "/") === "/onboarding/wallet";
      if (!requiresWalletLink) {
        router.push(payload.redirectTo || "/");
        router.refresh();
        return;
      }
      setStep("sign");
      await linkWalletForSession();
    });
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-8 flex items-center justify-center">
            <Image
              src="/arcenpay-logo.png"
              alt="ArcenPay"
              width={168}
              height={40}
              className="object-contain"
              priority
            />
          </div>

          <div className="mb-6 space-y-2 text-center">
            <h1 className="text-2xl font-semibold text-foreground">
              {step === "wallet" && "Connect your wallet"}
              {step === "email" && "Continue with your email"}
              {step === "code" && "Enter verification code"}
              {step === "sign" && "Sign wallet to finish"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {step === "wallet" &&
                `Connect the ${REQUIRED_WALLET_CHAIN_LABEL} wallet you want to use. After email verification, we'll request one signature and complete setup.`}
              {step === "email" &&
                "Once your wallet is connected, we'll send a 6-digit code to your email."}
              {step === "code" &&
                `We sent a code to ${email}. Enter it below to continue.`}
              {step === "sign" &&
                "One signature remains to link this wallet to your account."}
            </p>
          </div>

          {inviteToken ? (
            <div className="mb-5 rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
              Workspace invite detected. Use the invited email after connecting
              your wallet.
            </div>
          ) : null}

          {error ? (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {step === "wallet" ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-background p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-secondary p-2">
                    <Wallet className="h-5 w-5 text-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      Wallet status
                    </p>
                    {isConnected && address ? (
                      <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span className="font-mono">{shortAddress(address)}</span>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No wallet connected yet.
                      </p>
                    )}
                  </div>
                </div>
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
                    `Switch to ${REQUIRED_WALLET_CHAIN_LABEL}`
                  )}
                </Button>
              ) : null}

              <Button
                type="button"
                className="h-12 w-full"
                disabled={!isConnected || !address || !isOnRequiredNetwork}
                onClick={() => {
                  setError(null);
                  setStep("email");
                }}
              >
                Continue
              </Button>
            </div>
          ) : null}

          {step === "email" ? (
            <div className="space-y-5">
              <div className="rounded-xl border bg-background px-4 py-3 text-sm">
                <span className="text-muted-foreground">Connected wallet:</span>{" "}
                <span className="font-mono text-foreground">
                  {address ? shortAddress(address) : "Not connected"}
                </span>
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
                  className="h-12"
                />
              </div>

              <Button
                type="button"
                onClick={submitEmail}
                disabled={isPending || isLinkingWallet || !email.trim()}
                className="h-12 w-full"
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
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Dev code: <span className="font-mono font-semibold">{debugCode}</span>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("wallet");
                }}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to wallet step
              </button>
            </div>
          ) : null}

          {step === "code" ? (
            <div className="space-y-5">
              <div className="rounded-xl border bg-background px-4 py-3 text-sm">
                <div className="text-muted-foreground">Wallet</div>
                <div className="mt-1 font-mono text-foreground">
                  {address ? shortAddress(address) : "Not connected"}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">
                  Verification code
                </label>
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={setCode}
                  containerClassName="justify-center"
                  className="w-full"
                >
                  <InputOTPGroup className="gap-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <InputOTPSlot
                        key={index}
                        index={index}
                        className="h-12 w-10 rounded-md border"
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
                  <p className="text-xs text-amber-700">
                    Dev fallback code: <span className="font-mono">{debugCode}</span>
                  </p>
                ) : null}
              </div>

              <Button
                type="button"
                onClick={submitCode}
                disabled={isPending || isLinkingWallet || code.length !== 6}
                className="h-12 w-full"
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
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Change email
                </button>

                <button
                  type="button"
                  disabled={!canResend || isPending || isLinkingWallet}
                  onClick={submitEmail}
                  className="text-sm font-medium text-primary disabled:text-muted-foreground"
                >
                  {canResend ? "Resend code" : `Resend in ${timerLabel}`}
                </button>
              </div>
            </div>
          ) : null}

          {step === "sign" ? (
            <div className="space-y-5">
              <div className="rounded-xl border bg-background px-4 py-3 text-sm">
                <span className="text-muted-foreground">Connected wallet:</span>{" "}
                <span className="font-mono text-foreground">
                  {address ? shortAddress(address) : "Not connected"}
                </span>
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
                    `Switch to ${REQUIRED_WALLET_CHAIN_LABEL}`
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
                className="h-12 w-full"
              >
                {isLinkingWallet ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing wallet
                  </>
                ) : (
                  "Sign wallet and continue"
                )}
              </Button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("code");
                }}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to code
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
