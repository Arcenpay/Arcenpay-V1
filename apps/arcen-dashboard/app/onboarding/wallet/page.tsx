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
  Star,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSIWEMessage } from "@/lib/auth";
import {
  DEFAULT_WALLET_CHAIN_LABEL,
  SUPPORTED_WALLET_CHAIN_LABEL,
  useDashboardWallet,
} from "@/hooks/use-dashboard-wallet";
import { useStellarWallet } from "@/hooks/use-stellar-wallet";
import { getOnboardingChainFamily } from "@/lib/onboarding-chain-family";
import { getChainFamily } from "@arcenpay/internal-core";
import { toast } from "sonner";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import type { ChainFamily } from "@arcenpay/internal-core";

// ── EVM wallet section (same as before) ────────────────────────────────────

function EvmWalletConnect() {
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
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStoredWallet(data?.storedWallet ?? null))
      .catch(() => setStoredWallet(null));
  }, []);

  const handleLinkWallet = async () => {
    if (!address || !hasConnectedWallet) { toast.error("Connect your wallet first"); return; }
    if (!isOnRequiredNetwork) { toast.error(`Switch to a supported network (${SUPPORTED_WALLET_CHAIN_LABEL})`); return; }
    setIsSigning(true);
    try {
      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("Failed to get nonce");
      const { nonce, issuedAt } = await nonceRes.json();
      const message = buildSIWEMessage({ address, chainId, nonce, domain: window.location.host, uri: window.location.origin, issuedAt });
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/auth/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, address, chainId, nonce }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 409 && err.maskedOwnerEmail)
          throw new Error(`This wallet is already linked to another account (${err.maskedOwnerEmail}).`);
        throw new Error(err.error || "Failed to link wallet");
      }
      toast.success("Wallet linked successfully");
      router.push("/onboarding/provider-profile");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg.includes("rejected") || msg.includes("denied") ? "Signature cancelled" : msg);
    } finally { setIsSigning(false); }
  };

  if (storedWallet === undefined) {
    return (
      <div className="min-h-[200px] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {storedWallet ? (
        <div className="space-y-6">
          <div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Linked workspace key</span>
            <div className="mt-2 flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-brand shrink-0" />
              <code className="text-sm font-mono text-foreground break-all">{linkedWalletLabel}</code>
            </div>
          </div>
          {hasConnectedWallet && (
            <div className="space-y-3">
              {isLinkedWalletConnected && (
                <div className="flex items-center gap-2.5 text-sm text-foreground">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-brand" /><span>Connected wallet matches linked workspace wallet.</span>
                </div>
              )}
              {isWrongWalletConnected && (
                <div className="flex items-start gap-2.5 text-sm text-foreground">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-yellow-600" />
                  <span>Connected wallet does not match. Reconnect with <span className="font-mono font-semibold">{linkedWalletLabel}</span>.</span>
                </div>
              )}
              {isWrongNetwork && (
                <div className="flex items-start gap-2.5 text-sm text-foreground">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-yellow-600" />
                  <span>Wrong network. Switch to {DEFAULT_WALLET_CHAIN_LABEL}.</span>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {hasConnectedWallet && isWrongNetwork && (
              <Button variant="outline" size="sm" onClick={() => void switchToRequiredNetwork()} disabled={isSwitchingChain}>
                {isSwitchingChain ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Switching...</> : <><Shield className="w-3.5 h-3.5 mr-1.5" />Switch to {DEFAULT_WALLET_CHAIN_LABEL}</>}
              </Button>
            )}
            {hasConnectedWallet && isWrongWalletConnected && (
              <Button variant="outline" size="sm" onClick={() => void reconnectWallet()}><Wallet className="w-3.5 h-3.5 mr-1.5" />Reconnect</Button>
            )}
            {hasConnectedWallet ? (
              <Button variant="ghost" size="sm" onClick={() => void disconnectWallet()} className="text-muted-foreground hover:text-foreground">Disconnect</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => void openConnectModal()}><Wallet className="w-3.5 h-3.5 mr-1.5" />Connect Wallet</Button>
            )}
          </div>
          <div className="h-px bg-border" />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => router.back()}>Back</Button>
            <Button onClick={() => router.push("/onboarding/provider-profile")} className="min-w-[140px] bg-brand hover:bg-brand-dark text-primary-foreground">
              Continue<ArrowRight className="ml-1.5 w-4 h-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-lg font-medium text-foreground">Connect your EVM wallet</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">Link a wallet to execute on-chain settlements. No gas fees for linking.</p>
          </div>
          {hasConnectedWallet ? (
            <div className="space-y-4">
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Account</span>
                <code className="mt-2 block text-sm font-mono text-foreground font-semibold">{connectedWalletLabel}</code>
                <p className="mt-1 text-xs text-muted-foreground">Network: {currentNetworkLabel ?? "Unknown"}</p>
              </div>
              {isWrongNetwork && (
                <div className="flex items-start gap-2.5 text-sm"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-yellow-600" /><span>Switch to {SUPPORTED_WALLET_CHAIN_LABEL}.</span></div>
              )}
              <Button className="w-full h-11 bg-brand hover:bg-brand-dark text-primary-foreground" onClick={handleLinkWallet} disabled={isSigning || isWrongNetwork}>
                {isSigning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Waiting for Signature...</> : <><Shield className="w-4 h-4 mr-2" />Sign &amp; Link Workspace Wallet</>}
              </Button>
            </div>
          ) : (
            <>
              <Button className="w-full h-11 bg-brand hover:bg-brand-dark text-primary-foreground" onClick={() => void openConnectModal()}>
                <Wallet className="w-4 h-4 mr-2" />Connect Wallet
              </Button>
              <p className="text-xs text-muted-foreground">SIWE (Sign-In with Ethereum) — free signature, no gas cost.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stellar wallet section ──────────────────────────────────────────────────

const STELLAR_WALLETS = [
  {
    id: "freighter",
    name: "Freighter",
    description: "Browser extension wallet for Stellar",
    icon: "⭐",
    url: "https://www.freighter.app/",
  },
  {
    id: "xbull",
    name: "xBull Wallet",
    description: "Non-custodial Stellar wallet",
    icon: "🐂",
    url: "https://xbull.app/",
  },
  {
    id: "albedo",
    name: "Albedo",
    description: "Stellar web wallet (no extension)",
    icon: "🌐",
    url: "https://albedo.link/",
  },
  {
    id: "lobstr",
    name: "LOBSTR",
    description: "Popular Stellar mobile & web wallet",
    icon: "🦞",
    url: "https://lobstr.co/",
  },
];

function StellarWalletConnect({ onLinked }: { onLinked: (address: string) => void }) {
  const wallet = useStellarWallet();
  const [isSigning, setIsSigning] = useState(false);

  const handleLink = async () => {
    if (!wallet.address) { toast.error("Connect a Stellar wallet first"); return; }
    setIsSigning(true);
    try {
      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("Failed to get nonce");
      const { nonce, issuedAt } = await nonceRes.json();
      const message = `ArcenPay Stellar Sign-In\n\nAddress: ${wallet.address}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nDomain: ${window.location.host}`;
      const { signedMessage } = await wallet.signMessage(message);

      const res = await fetch("/api/auth/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature: signedMessage, address: wallet.address, chainId: wallet.chainId, nonce }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to link wallet");
      }
      toast.success("Stellar wallet linked");
      onLinked(wallet.address);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg.includes("rejected") || msg.includes("denied") ? "Signature cancelled" : msg);
    } finally { setIsSigning(false); }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h2 className="text-lg font-medium text-foreground">Connect your Stellar wallet</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Connect a Stellar wallet to manage on-chain subscriptions. The wallet selector will open in a popup.
        </p>
      </div>

      {wallet.isConnected && wallet.address ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-brand/5 border border-brand/20">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-brand shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Connected</p>
                <code className="text-xs font-mono text-muted-foreground break-all">{wallet.address}</code>
              </div>
            </div>
          </div>
          <Button className="w-full h-11 bg-brand hover:bg-brand-dark text-primary-foreground" onClick={handleLink} disabled={isSigning}>
            {isSigning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing...</> : <><Star className="w-4 h-4 mr-2" />Sign &amp; Link Stellar Wallet</>}
          </Button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground rounded-lg flex items-center justify-center gap-2 font-medium"
            onClick={() => void wallet.connect()}
            disabled={wallet.isLoading}
          >
            {wallet.isLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Opening wallet selector...</>
            ) : (
              <><Star className="h-4 w-4" />Connect Stellar wallet</>
            )}
          </button>
          {wallet.error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-700 text-xs">{wallet.error}</div>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">Stellar message signing — free, no transaction fee.</p>
    </div>
  );
}

// ── Main page — dispatches to EVM or Stellar ───────────────────────────────

export default function ConnectWalletPage() {
  const router = useRouter();
  const [storedWallet, setStoredWallet] = useState<string | null | undefined>(undefined);
  const [family] = useState<ChainFamily | null>(() => getOnboardingChainFamily());

  // Check if wallet is already linked (skip chain-family choice for existing users)
  useEffect(() => {
    fetch("/api/auth/wallet-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStoredWallet(data?.storedWallet ?? null))
      .catch(() => setStoredWallet(null));
  }, []);

  // If wallet is already linked, proceed without chain-family check
  const needsFamilySelection = !storedWallet && !family;

  if (storedWallet === undefined) {
    return (
      <OnboardingShell step={1} stepTitle="Connect Wallet" stepDescription="Loading...">
        <div className="min-h-[200px] flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </OnboardingShell>
    );
  }

  if (needsFamilySelection) {
    return (
      <OnboardingShell step={1} stepTitle="Connect Wallet" stepDescription="Link your wallet to start.">
        <div className="max-w-lg text-center space-y-4">
          <p className="text-muted-foreground">No blockchain ecosystem selected. Please choose one first.</p>
          <Button onClick={() => router.push("/onboarding/chain")} variant="outline">Choose Blockchain</Button>
        </div>
      </OnboardingShell>
    );
  }

  const handleStellarLinked = (_addr: string) => {
    router.push("/onboarding/provider-profile");
    router.refresh();
  };

  return (
    <OnboardingShell
      step={2}
      stepTitle={family === "evm" ? "Connect EVM Wallet" : "Connect Stellar Wallet"}
      stepDescription="Link your wallet to continue."
    >
      <div className="max-w-lg">
        <div className="mb-6 sm:mb-10">
          <h1 className="text-2xl sm:text-[28px] font-semibold text-foreground tracking-tight">
            {family === "evm" ? "Link Your EVM Wallet" : "Link Your Stellar Wallet"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-2 sm:mt-3 leading-relaxed">
            {family === "evm"
              ? `Link an owner address for on-chain settlements. Supported: ${SUPPORTED_WALLET_CHAIN_LABEL}.`
              : "Connect your Freighter wallet to manage Stellar subscriptions."}
          </p>
        </div>

        {family === "evm" ? <EvmWalletConnect /> : <StellarWalletConnect onLinked={handleStellarLinked} />}

        <div className="pt-8 border-t border-border mt-10 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-brand" />Secure Signing
          </span>
          <span>No gas fees required</span>
        </div>
      </div>
    </OnboardingShell>
  );
}
