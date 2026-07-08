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
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSIWEMessage } from "@/lib/auth";
import {
  DEFAULT_WALLET_CHAIN_LABEL,
  SUPPORTED_WALLET_CHAIN_LABEL,
  useDashboardWallet,
} from "@/hooks/use-dashboard-wallet";
import { toast } from "sonner";

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4 md:p-6 font-sans">
      <div className="w-full max-w-4xl grid md:grid-cols-[280px_1fr] rounded-2xl border border-border bg-card text-card-foreground shadow-lg overflow-hidden">
        
        {/* Left Side: Step Tracker */}
        <div className="border-b border-border bg-muted/40 p-6 md:p-8 md:border-b-0 md:border-r">
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
            Onboarding Setup
          </span>
          <h2 className="mt-1.5 text-lg font-semibold text-foreground">Get Started</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure your billing workspace.
          </p>

          <div className="mt-8 space-y-6">
            {/* Step 1 */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                  1
                </div>
                <div className="w-0.5 flex-1 bg-border min-h-8 mt-2" />
              </div>
              <div className="pt-0.5">
                <p className="text-xs font-semibold text-foreground">Workspace Wallet</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Link your owner key</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full border border-border bg-muted/50 text-muted-foreground flex items-center justify-center text-xs font-semibold">
                  2
                </div>
                <div className="w-0.5 flex-1 bg-border min-h-8 mt-2" />
              </div>
              <div className="pt-0.5">
                <p className="text-xs font-medium text-muted-foreground">Provider Profile</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">Business & support info</p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full border border-border bg-muted/50 text-muted-foreground flex items-center justify-center text-xs font-semibold">
                  3
                </div>
              </div>
              <div className="pt-0.5">
                <p className="text-xs font-medium text-muted-foreground">Environment</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">Launch environment</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Step Content Area */}
        <div className="p-6 md:p-10 flex flex-col justify-between">
          <div className="space-y-6">
            <div>
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
                <Wallet className="w-4 h-4" />
              </div>
              <h1 className="text-xl font-semibold text-foreground mt-4">
                {storedWallet ? "Linked Workspace Wallet" : "Link Your Wallet"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Link an owner address to execute on-chain settlements and sign billing instructions. Supported networks: <span className="text-foreground font-semibold">{SUPPORTED_WALLET_CHAIN_LABEL}</span>.
              </p>
            </div>

            <div className="h-px bg-border" />

            {storedWallet ? (
              /* ALREADY LINKED STATE */
              <div className="space-y-5">
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">Linked workspace key</span>
                    <div className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border">
                      <Shield className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      <code className="text-xs font-mono text-foreground break-all">
                        {linkedWalletLabel}
                      </code>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                      <span className="text-[10px] text-muted-foreground block uppercase font-semibold">Active Network</span>
                      <span className="mt-0.5 text-xs font-semibold text-foreground block">
                        {SUPPORTED_WALLET_CHAIN_LABEL}
                      </span>
                    </div>

                    <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                      <span className="text-[10px] text-muted-foreground block uppercase font-semibold">Connected Account</span>
                      <span className="mt-0.5 text-xs font-semibold text-foreground block font-mono truncate">
                        {hasConnectedWallet ? connectedWalletLabel : "Not connected"}
                      </span>
                    </div>
                  </div>

                  {hasConnectedWallet && (
                    <div className="space-y-3 pt-1">
                      {isLinkedWalletConnected ? (
                        <div className="flex items-center gap-2 text-xs text-green-600 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-600" />
                          <span>Connected wallet matches linked workspace wallet.</span>
                        </div>
                      ) : null}

                      {isWrongWalletConnected ? (
                        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2.5 text-xs text-yellow-700 dark:text-yellow-500">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-yellow-600 dark:text-yellow-500" />
                          <span>
                            Connected wallet does not match the linked owner address. Reconnect with{" "}
                            <span className="font-mono text-foreground font-semibold">
                              {linkedWalletLabel}
                            </span>
                            .
                          </span>
                        </div>
                      ) : null}

                      {isWrongNetwork ? (
                        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2.5 text-xs text-yellow-700 dark:text-yellow-500">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-yellow-600 dark:text-yellow-500" />
                          <span>
                            Your wallet is on the wrong network. Switch to a supported environment to resume.
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {hasConnectedWallet && isWrongNetwork && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void switchToRequiredNetwork()}
                        disabled={isSwitchingChain}
                      >
                        {isSwitchingChain ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                            Switching...
                          </>
                        ) : (
                          <>
                            <Shield className="w-3 h-3 mr-1.5" />
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
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => router.push("/")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Back to dashboard
                  </Button>
                  <Button
                    onClick={() => router.push("/onboarding/provider-profile")}
                    className="min-w-36"
                  >
                    Continue to Profile
                    <ChevronRight className="ml-1.5 w-4 h-4" />
                  </Button>
                </div>
              </div>
            ) : (
              /* CONNECTING AND LINKING FLOW */
              <div className="space-y-4">
                {hasConnectedWallet ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border">
                      <div>
                        <span className="text-[10px] text-muted-foreground block uppercase font-semibold">
                          Active Account
                        </span>
                        <div className="mt-1 flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-green-500" />
                          <code className="text-sm font-mono text-foreground font-semibold">
                            {connectedWalletLabel}
                          </code>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Network: {currentNetworkLabel ?? "Unknown"}
                        </p>
                      </div>
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors font-medium border border-border bg-background px-2.5 py-1 rounded-md"
                        onClick={() => void reconnectWallet()}
                      >
                        Change
                      </button>
                    </div>

                    {isWrongNetwork ? (
                      <div className="space-y-3">
                        <div className="flex items-start gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-700 dark:text-yellow-500">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-yellow-600 dark:text-yellow-500" />
                          <span>
                            Please switch your wallet to a supported network (
                            <span className="text-foreground font-semibold">{SUPPORTED_WALLET_CHAIN_LABEL}</span>
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
                      className="w-full h-11"
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
                  <div className="rounded-xl border border-border bg-muted/20 p-6 text-center space-y-4">
                    <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                      Connect the wallet you want to link. Sign a free secure proof to link it to your workspace.
                    </p>
                    <Button className="w-full h-11" onClick={() => void openConnectModal()}>
                      <Wallet className="w-4 h-4 mr-2" />
                      Connect Wallet
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-8 border-t border-border pt-4 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-green-600" />
              Secure SIWE Proof
            </span>
            <span>No gas fees required</span>
          </div>
        </div>

      </div>
    </div>
  );
}
