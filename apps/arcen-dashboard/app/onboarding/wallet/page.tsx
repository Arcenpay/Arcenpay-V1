"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useChainId, useSignMessage } from "wagmi";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Shield,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSIWEMessage } from "@/lib/auth";
import {
  REQUIRED_WALLET_CHAIN_LABEL,
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
      toast.error(`Switch to ${REQUIRED_WALLET_CHAIN_LABEL} before signing`);
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

      toast.success("Wallet linked");
      router.push("/");
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
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (storedWallet) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Wallet linked</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Your workspace wallet is already set.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Linked workspace wallet</p>
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-secondary/50 border border-border">
                <Shield className="w-3.5 h-3.5 text-green-500 shrink-0" />
                <code className="text-sm font-mono text-foreground">{linkedWalletLabel}</code>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-3">
              <p className="text-xs text-muted-foreground">Supported network</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {REQUIRED_WALLET_CHAIN_LABEL}
              </p>
            </div>

            {hasConnectedWallet ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-secondary/30 px-3 py-3">
                  <p className="text-xs text-muted-foreground">Connected wallet</p>
                  <p className="mt-1 text-sm font-medium text-foreground font-mono">
                    {connectedWalletLabel}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Network: {currentNetworkLabel ?? "Unknown"}
                  </p>
                </div>

                {isLinkedWalletConnected ? (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    Connected wallet matches your workspace wallet.
                  </div>
                ) : null}

                {isWrongWalletConnected ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-sm text-amber-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      A different wallet is connected. Reconnect with {linkedWalletLabel} to use
                      dashboard signing and on-chain actions.
                    </span>
                  </div>
                ) : null}

                {isWrongNetwork ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-sm text-amber-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Switch this wallet to {REQUIRED_WALLET_CHAIN_LABEL} to continue.</span>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-2">
                  {isWrongNetwork ? (
                    <Button
                      variant="outline"
                      onClick={() => void switchToRequiredNetwork()}
                      disabled={isSwitchingChain}
                    >
                      {isSwitchingChain ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                          Switching network...
                        </>
                      ) : (
                        <>
                          <Shield className="w-3.5 h-3.5 mr-2" />
                          Switch to {REQUIRED_WALLET_CHAIN_LABEL}
                        </>
                      )}
                    </Button>
                  ) : null}

                  {isWrongWalletConnected ? (
                    <Button variant="outline" onClick={() => void reconnectWallet()}>
                      <Wallet className="w-3.5 h-3.5 mr-2" />
                      Reconnect correct wallet
                    </Button>
                  ) : null}

                  <Button variant="ghost" onClick={() => void disconnectWallet()}>
                    Disconnect current wallet
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-sm text-muted-foreground">
                  Connect your linked workspace wallet on {REQUIRED_WALLET_CHAIN_LABEL} to use
                  on-chain actions.
                </p>
                <Button className="w-full" variant="outline" onClick={() => void openConnectModal()}>
                  <Wallet className="w-3.5 h-3.5 mr-2" />
                  Connect wallet
                </Button>
              </div>
            )}
          </div>

          <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => router.push("/")}>
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-primary/5 border border-border flex items-center justify-center">
            <Wallet className="w-6 h-6 text-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Link your wallet</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              The dashboard currently supports {REQUIRED_WALLET_CHAIN_LABEL} only.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-0 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-medium text-[10px]">
                  1
                </span>
                Connect
              </span>
              <div className="flex-1 h-px bg-border mx-2" />
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-secondary border border-border text-muted-foreground flex items-center justify-center font-medium text-[10px]">
                  2
                </span>
                Sign
              </span>
              <div className="flex-1 h-px bg-border mx-2" />
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-secondary border border-border text-muted-foreground flex items-center justify-center font-medium text-[10px]">
                  3
                </span>
                Done
              </span>
            </div>

            <div className="h-px bg-border" />

            {hasConnectedWallet ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-secondary/50 border border-border">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <code className="text-sm font-mono text-foreground">{connectedWalletLabel}</code>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Network: {currentNetworkLabel ?? "Unknown"}
                    </p>
                  </div>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => void reconnectWallet()}
                  >
                    Change
                  </button>
                </div>

                {isWrongNetwork ? (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-sm text-amber-700">
                    Switch this wallet to {REQUIRED_WALLET_CHAIN_LABEL} before linking it.
                  </div>
                ) : null}

                {isWrongNetwork ? (
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
                        Switch to {REQUIRED_WALLET_CHAIN_LABEL}
                      </>
                    )}
                  </Button>
                ) : null}

                <Button className="w-full" onClick={handleLinkWallet} disabled={isSigning || isWrongNetwork}>
                  {isSigning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Waiting for signature...
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4 mr-2" />
                      Sign and link wallet
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Connect the Base Sepolia wallet you want to use for this workspace.
                </p>
                <Button className="w-full" onClick={() => void openConnectModal()}>
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

        <p className="text-xs text-center text-muted-foreground/60 leading-relaxed">
          This wallet becomes the workspace signing wallet for dashboard actions on
          {" "}{REQUIRED_WALLET_CHAIN_LABEL}.
        </p>
      </div>
    </div>
  );
}
