"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useChainId, useSignMessage } from "wagmi";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Shield,
  Wallet,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSIWEMessage } from "@/lib/auth";
import {
  DEFAULT_WALLET_CHAIN_LABEL,
  SUPPORTED_WALLET_CHAIN_LABEL,
  useDashboardWallet,
} from "@/hooks/use-dashboard-wallet";
import { toast } from "sonner";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";

export default function ConnectWalletPage() {
  const router = useRouter();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const [isSigning, setIsSigning] = useState(false);
  const [storedWallet, setStoredWallet] = useState<string | null | undefined>(undefined);
  const {
    address,
    connectedWalletLabel,
    currentNetworkLabel,
    disconnectWallet,
    hasConnectedWallet,
    isLinkedWalletConnected,
    isOnRequiredNetwork,
    isSwitchingChain,
    isWrongNetwork,
    isWrongWalletConnected,
    linkedWalletLabel,
    openConnectModal,
    reconnectWallet,
    switchToRequiredNetwork,
  } = useDashboardWallet(storedWallet);

  useEffect(() => {
    fetch("/api/auth/wallet-status")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setStoredWallet(data?.storedWallet ?? null))
      .catch(() => setStoredWallet(null));
  }, []);

  const handleLinkWallet = async () => {
    if (!address || !hasConnectedWallet) {
      toast.error("Connect your wallet first");
      return;
    }

    if (!isOnRequiredNetwork) {
      toast.error(
        `Switch to a supported network (${SUPPORTED_WALLET_CHAIN_LABEL}) before signing`,
      );
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
      const response = await fetch("/api/auth/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, address, chainId, nonce }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        if (response.status === 409 && errorPayload.maskedOwnerEmail) {
          throw new Error(
            `This wallet is already linked to another account (${errorPayload.maskedOwnerEmail}). Please sign in with that email instead.`,
          );
        }
        throw new Error(errorPayload.error || "Failed to link wallet");
      }

      toast.success("Wallet linked successfully");
      router.push("/onboarding/provider-profile");
      router.refresh();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Something went wrong";
      if (message.includes("rejected") || message.includes("denied")) {
        toast.error("Signature cancelled");
      } else {
        toast.error(message);
      }
    } finally {
      setIsSigning(false);
    }
  };

  if (storedWallet === undefined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <OnboardingShell
      step={1}
      stepTitle="Get Started"
      stepDescription="Configure your billing workspace."
    >
      <div className="max-w-lg">
        {/* Header */}
        <div className="mb-6 sm:mb-10">
          <h1 className="text-2xl sm:text-[28px] font-semibold text-foreground tracking-tight">
            {storedWallet ? "Linked Workspace Wallet" : "Link Your Wallet"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-2 sm:mt-3 leading-relaxed">
            Link an owner address to execute on-chain settlements and sign billing instructions. Supported networks:{" "}
            <span className="font-medium text-foreground">{SUPPORTED_WALLET_CHAIN_LABEL}</span>.
          </p>
        </div>

        {storedWallet ? (
          /* ALREADY LINKED STATE */
          <div className="space-y-8">
            {/* Linked Key */}
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Linked workspace key
              </span>
              <div className="mt-2 flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-brand shrink-0" />
                <code className="text-sm font-mono text-foreground break-all">
                  {linkedWalletLabel}
                </code>
              </div>
            </div>

            {/* Info Grid */}
            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Active Network
                </span>
                <p className="mt-1.5 text-sm font-medium text-foreground">
                  {SUPPORTED_WALLET_CHAIN_LABEL}
                </p>
              </div>

              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Connected Account
                </span>
                <p className="mt-1.5 text-sm font-medium text-foreground font-mono truncate">
                  {hasConnectedWallet ? connectedWalletLabel : "Not connected"}
                </p>
              </div>
            </div>

            {/* Status Messages */}
            {hasConnectedWallet && (
              <div className="space-y-3">
                {isLinkedWalletConnected ? (
                  <div className="flex items-center gap-2.5 text-sm text-foreground">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-brand" />
                    <span>Connected wallet matches linked workspace wallet.</span>
                  </div>
                ) : null}

                {isWrongWalletConnected ? (
                  <div className="flex items-start gap-2.5 text-sm text-foreground">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-yellow-600" />
                    <span>
                      Connected wallet does not match the linked owner address. Reconnect with{" "}
                      <span className="font-mono font-semibold">
                        {linkedWalletLabel}
                      </span>
                      .
                    </span>
                  </div>
                ) : null}

                {isWrongNetwork ? (
                  <div className="flex items-start gap-2.5 text-sm text-foreground">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-yellow-600" />
                    <span>
                      Your wallet is on the wrong network. Switch to a supported environment to resume.
                    </span>
                  </div>
                ) : null}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-3">
              {hasConnectedWallet && isWrongNetwork && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void switchToRequiredNetwork()}
                  disabled={isSwitchingChain}
                >
                  {isSwitchingChain ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Switching...
                    </>
                  ) : (
                    <>
                      <Shield className="w-3.5 h-3.5 mr-1.5" />
                      Switch to {DEFAULT_WALLET_CHAIN_LABEL}
                    </>
                  )}
                </Button>
              )}

              {hasConnectedWallet && isWrongWalletConnected && (
                <Button variant="outline" size="sm" onClick={() => void reconnectWallet()}>
                  <Wallet className="w-3.5 h-3.5 mr-1.5" />
                  Reconnect linked wallet
                </Button>
              )}

              {hasConnectedWallet ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void disconnectWallet()}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Disconnect Wallet
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void openConnectModal()}>
                  <Wallet className="w-3.5 h-3.5 mr-1.5" />
                  Connect Wallet
                </Button>
              )}
            </div>

            <div className="h-px bg-border" />

            <div className="flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => router.push("/")}
                className="text-muted-foreground hover:text-foreground"
              >
                Back to dashboard
              </Button>
              <Button
                onClick={() => router.push("/onboarding/provider-profile")}
                className="min-w-[140px] bg-brand hover:bg-brand-dark text-primary-foreground"
              >
                Continue
                <ArrowRight className="ml-1.5 w-4 h-4" />
              </Button>
            </div>
          </div>
        ) : (
          /* CONNECTING AND LINKING FLOW */
          <div className="space-y-8">
            {hasConnectedWallet ? (
              <div className="space-y-6">
                {/* Active Account */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Active Account
                    </span>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-brand" />
                      <code className="text-sm font-mono text-foreground font-semibold">
                        {connectedWalletLabel}
                      </code>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Network: {currentNetworkLabel ?? "Unknown"}
                    </p>
                  </div>
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors font-medium underline underline-offset-4"
                    onClick={() => void reconnectWallet()}
                  >
                    Change
                  </button>
                </div>

                {isWrongNetwork ? (
                  <div className="space-y-4">
                    <div className="flex items-start gap-2.5 text-sm text-foreground">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-yellow-600" />
                      <span>
                        Please switch your wallet to a supported network (
                        <span className="font-semibold">{SUPPORTED_WALLET_CHAIN_LABEL}</span>
                        ) before linking it.
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => void switchToRequiredNetwork()}
                      disabled={isSwitchingChain}
                    >
                      {isSwitchingChain ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Switching network...
                        </>
                      ) : (
                        <>
                          <Shield className="w-4 h-4 mr-2" />
                          Switch to {DEFAULT_WALLET_CHAIN_LABEL}
                        </>
                      )}
                    </Button>
                  </div>
                ) : null}

                <Button
                  className="w-full h-11 bg-brand hover:bg-brand-dark text-primary-foreground"
                  onClick={handleLinkWallet}
                  disabled={isSigning || isWrongNetwork}
                >
                  {isSigning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Waiting for Signature...
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4 mr-2" />
                      Sign &amp; Link Workspace Wallet
                    </>
                  )}
                </Button>
              </div>
            ) : (
              /* NOT CONNECTED — Clean minimal layout */
              <div className="space-y-6">
                <div className="space-y-4">
                  <h2 className="text-lg font-medium text-foreground">
                    Connect your wallet
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Link a wallet to execute on-chain settlements and sign billing instructions. No gas fees required for linking.
                  </p>
                </div>

                <Button 
                  className="w-full h-11 bg-brand hover:bg-brand-dark text-primary-foreground text-sm font-medium"
                  onClick={() => void openConnectModal()}
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  Connect Wallet
                </Button>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  We use SIWE (Sign-In with Ethereum) to verify wallet ownership. This is a free signature with no gas cost.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="pt-8 border-t border-border mt-10 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-brand" />
            Secure SIWE Proof
          </span>
          <span>No gas fees required</span>
        </div>
      </div>
    </OnboardingShell>
  );
}
