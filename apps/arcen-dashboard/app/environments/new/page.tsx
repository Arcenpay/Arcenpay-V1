"use client";
import { apiFetch } from "@/lib/api-client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useChainId, useSignMessage } from "wagmi";
import { ArrowLeft, Building2, CheckCircle2, Loader2, Shield, Wallet } from "lucide-react";
import { NetworkIcon } from "@web3icons/react/dynamic";
import { Web3Icon } from "@/components/web3-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BOT_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  getChainLabel,
  getChainIdsForEnvironment,
  type EnvironmentMode,
} from "@/lib/default-chain";
import { getChainFamily } from "@arcenpay/internal-core";
import type { ChainFamily } from "@arcenpay/internal-core";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { useDashboardWallet } from "@/hooks/use-dashboard-wallet";
import { useStellarWallet } from "@/hooks/use-stellar-wallet";
import { useSolanaWallet } from "@/hooks/use-solana-wallet";
import { buildSIWEMessage } from "@/lib/auth";

interface ChainOption {
  chainId: number;
  label: string;
}

const ALL_CHAIN_FAMILIES: Array<{
  value: ChainFamily;
  label: string;
  renderLabel: () => React.ReactNode;
}> = [
  {
    value: "evm",
    label: "EVM (BOT Chain, Base, Arc, Ethereum)",
    renderLabel: () => (
      <span className="flex items-center gap-2">
        <span className="w-[18px] h-[18px] rounded-full overflow-hidden inline-flex items-center justify-center bg-white dark:bg-white p-px ring-1 ring-border shrink-0">
          <Image
            src="/botchain.jpg"
            alt="BOT Chain"
            width={18}
            height={18}
            className="rounded-full object-cover shrink-0"
            unoptimized
          />
        </span>
        EVM (BOT Chain, Base, Arc, Ethereum)
      </span>
    ),
  },
  {
    value: "stellar",
    label: "Stellar (Soroban)",
    renderLabel: () => (
      <span className="flex items-center gap-2">
        <NetworkIcon name="stellar" variant="branded" size={18} className="rounded-full bg-white dark:bg-white p-px" />
        Stellar (Soroban)
      </span>
    ),
  },
  {
    value: "solana",
    label: "Solana (Anchor)",
    renderLabel: () => (
      <span className="flex items-center gap-2">
        <NetworkIcon name="solana" variant="branded" size={18} className="rounded-full bg-white dark:bg-white p-px" />
        Solana (Anchor)
      </span>
    ),
  },
];

function buildChainOptions(mode: EnvironmentMode, family: ChainFamily): ChainOption[] {
  return getChainIdsForEnvironment(mode)
    .filter((chainId) => getChainFamily(chainId) === family)
    .map((chainId) => ({
      chainId,
      label: getChainLabel(chainId),
    }));
}

function firstChainForFamily(mode: EnvironmentMode, family: ChainFamily): number {
  const opts = buildChainOptions(mode, family);
  if (opts.length > 0) return opts[0].chainId;
  if (mode === "PRODUCTION") {
    if (family === "solana") return SOLANA_MAINNET_CHAIN_ID;
    return BOT_MAINNET_CHAIN_ID;
  }
  if (family === "solana") return SOLANA_DEVNET_CHAIN_ID;
  if (family === "stellar") return STELLAR_TESTNET_CHAIN_ID;
  return BASE_SEPOLIA_CHAIN_ID;
}

export default function NewEnvironmentPage() {
  const router = useRouter();
  const { data, isLoading, refresh } = useDashboardSession();
  const stellarWallet = useStellarWallet();
  const solanaWallet = useSolanaWallet();
  const wagmiChainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const {
    address: evmAddress,
    isConnected: isEvmConnected,
    isOnRequiredNetwork: isEvmOnRequired,
    openConnectModal,
    switchToRequiredNetwork,
    isSwitchingChain,
  } = useDashboardWallet();

  const [name, setName] = useState("");
  const [mode, setMode] = useState<EnvironmentMode>("DEVELOPMENT");
  const [chainFamily, setChainFamily] = useState<ChainFamily>("evm");
  const [chainId, setChainId] = useState<number>(firstChainForFamily("DEVELOPMENT", "evm"));
  const [productionEnabled, setProductionEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLinkingWallet, setIsLinkingWallet] = useState(false);

  const canManage =
    data?.currentTeam?.role === "OWNER" || data?.currentTeam?.role === "ADMIN";

  const availableFamilies = useMemo(() => {
    return ALL_CHAIN_FAMILIES.filter(
      (f) => buildChainOptions(mode, f.value).length > 0,
    );
  }, [mode]);

  useEffect(() => {
    if (!availableFamilies.some((f) => f.value === chainFamily)) {
      setChainFamily(availableFamilies[0]?.value ?? "evm");
    }
  }, [availableFamilies, chainFamily]);

  const chainOptions = useMemo(
    () => buildChainOptions(mode, chainFamily),
    [mode, chainFamily],
  );

  const hasStellarWallet = !!data?.user?.stellarWalletAddress;
  const hasEvmWallet = !!data?.user?.walletAddress;
  const hasSolanaWallet = !!data?.user?.solanaWalletAddress;
  const needsWallet =
    chainFamily === "stellar"
      ? !hasStellarWallet
      : chainFamily === "solana"
        ? !hasSolanaWallet
        : !hasEvmWallet;

  useEffect(() => {
    setChainId(firstChainForFamily(mode, chainFamily));
  }, [mode, chainFamily]);

  useEffect(() => {
    apiFetch("/api/environments", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { productionEnabled?: boolean } | null) => {
        setProductionEnabled(payload?.productionEnabled === true);
      })
      .catch(() => setProductionEnabled(false));
  }, []);

  async function handleLinkEvmWallet() {
    if (!evmAddress || !isEvmConnected) {
      setError("Connect your wallet first.");
      return;
    }
    if (!isEvmOnRequired) {
      setError("Switch to a supported network before signing.");
      return;
    }
    setIsLinkingWallet(true);
    setError(null);
    try {
      const nonceRes = await apiFetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("Could not start wallet verification.");
      const { nonce, issuedAt } = await nonceRes.json();

      const message = buildSIWEMessage({
        address: evmAddress,
        chainId: wagmiChainId,
        nonce,
        domain: window.location.host,
        uri: window.location.origin,
        issuedAt,
      });
      const signature = await signMessageAsync({ message });

      const linkRes = await apiFetch("/api/auth/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          signature,
          address: evmAddress,
          chainId: wagmiChainId,
          nonce,
        }),
      });
      const linkPayload = await linkRes.json().catch(() => ({}));
      if (!linkRes.ok) {
        if (linkRes.status === 409 && linkPayload.maskedOwnerEmail) {
          throw new Error(
            `This wallet is already linked to another account (${linkPayload.maskedOwnerEmail}).`,
          );
        }
        throw new Error(linkPayload.error || "Could not link wallet.");
      }

      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not link wallet.";
      setError(msg.toLowerCase().includes("rejected") ? "Signature cancelled." : msg);
    } finally {
      setIsLinkingWallet(false);
    }
  }

  async function handleLinkStellarWallet() {
    if (!stellarWallet.address) {
      setError("Connect your Stellar wallet first.");
      return;
    }
    setIsLinkingWallet(true);
    setError(null);
    try {
      const nonceRes = await apiFetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("Could not start wallet verification.");
      const { nonce, issuedAt } = await nonceRes.json();

      const message = `ArcenPay Stellar Sign-In\n\nAddress: ${stellarWallet.address}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nDomain: ${window.location.host}`;
      const { signedMessage } = await stellarWallet.signMessage(message);

      const linkRes = await apiFetch("/api/auth/link-wallet", {
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
      const linkPayload = await linkRes.json().catch(() => ({}));
      if (!linkRes.ok) {
        throw new Error(linkPayload.error || "Could not link wallet.");
      }

      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not link wallet.";
      setError(msg.toLowerCase().includes("rejected") ? "Signature cancelled." : msg);
    } finally {
      setIsLinkingWallet(false);
    }
  }

  async function handleLinkSolanaWallet() {
    if (!solanaWallet.address) {
      setError("Connect your Solana wallet first.");
      return;
    }
    setIsLinkingWallet(true);
    setError(null);
    try {
      const nonceRes = await apiFetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("Could not start wallet verification.");
      const { nonce, issuedAt } = await nonceRes.json();

      // Must match the backend's expected message exactly (link-wallet.ts).
      const message = `ArcenPay Solana Sign-In\n\nAddress: ${solanaWallet.address}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nDomain: ${window.location.host}`;
      const { signedMessage } = await solanaWallet.signMessage(message);

      const linkRes = await apiFetch("/api/auth/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          signature: signedMessage,
          address: solanaWallet.address,
          chainId: chainId ?? SOLANA_MAINNET_CHAIN_ID,
          nonce,
        }),
      });
      const linkPayload = await linkRes.json().catch(() => ({}));
      if (!linkRes.ok) {
        throw new Error(linkPayload.error || "Could not link wallet.");
      }

      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not link wallet.";
      setError(msg.toLowerCase().includes("rejected") ? "Signature cancelled." : msg);
    } finally {
      setIsLinkingWallet(false);
    }
  }

  async function handleCreate() {
    if (needsWallet) {
      setError("A compatible wallet must be linked for this chain before creating the environment.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/environments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          chainId,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        environment?: { id: string };
      };
      if (!res.ok) {
        setError(payload.error || "Failed to create environment");
        return;
      }
      if (payload.environment?.id) {
        await apiFetch("/api/environments/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ environmentId: payload.environment.id }),
        }).catch(() => {});
      }
      await refresh();
      window.location.assign("/");
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Only workspace owners and admins can create environments.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-4 sm:px-8 py-4 sm:py-6 lg:px-12 flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/?section=settings&tab=workspace")}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to settings
        </button>

        {/* Connected wallet badge — ecosystem-aware */}
        {chainFamily === "stellar" ? (
          hasStellarWallet ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-brand/5 border border-brand/20 px-3 py-1.5 text-xs">
              <NetworkIcon name="stellar" variant="branded" size={14} className="rounded-full bg-white dark:bg-white p-px" />
              <span className="text-muted-foreground">
                {data?.user?.stellarWalletAddress
                  ? `${data.user.stellarWalletAddress.slice(0, 8)}...${data.user.stellarWalletAddress.slice(-4)}`
                  : ""}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-brand" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-muted border border-border px-3 py-1.5 text-xs text-muted-foreground">
              <NetworkIcon name="stellar" variant="branded" size={14} className="rounded-full opacity-40" />
              Stellar wallet not linked
            </span>
          )
        ) : chainFamily === "solana" ? (
          hasSolanaWallet ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-brand/5 border border-brand/20 px-3 py-1.5 text-xs">
              <NetworkIcon name="solana" variant="branded" size={14} className="rounded-full bg-white dark:bg-white p-px" />
              <span className="text-muted-foreground font-mono">
                {data?.user?.solanaWalletAddress
                  ? `${data.user.solanaWalletAddress.slice(0, 6)}...${data.user.solanaWalletAddress.slice(-4)}`
                  : ""}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-brand" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-muted border border-border px-3 py-1.5 text-xs text-muted-foreground">
              <NetworkIcon name="solana" variant="branded" size={14} className="rounded-full opacity-40" />
              Solana wallet not linked
            </span>
          )
        ) : (
          hasEvmWallet ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-brand/5 border border-brand/20 px-3 py-1.5 text-xs">
              <NetworkIcon name="ethereum" variant="branded" size={14} className="rounded-full bg-white dark:bg-white p-px" />
              <span className="text-muted-foreground font-mono">
                {data?.user?.walletAddress
                  ? `${data.user.walletAddress.slice(0, 6)}...${data.user.walletAddress.slice(-4)}`
                  : ""}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-muted border border-border px-3 py-1.5 text-xs text-muted-foreground">
              <NetworkIcon name="ethereum" variant="branded" size={14} className="rounded-full opacity-40" />
              EVM wallet not linked
            </span>
          )
        )}
      </div>

      <div className="flex-1 flex items-start justify-center px-4 sm:px-8 pb-10">
        <div className="w-full max-w-lg pt-8">
          <div className="mb-8">
            <h1 className="text-2xl sm:text-[28px] font-semibold text-foreground tracking-tight">
              Create Environment
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-3 leading-relaxed">
              Each environment pins this workspace to a specific blockchain network.
            </p>
          </div>

          <div className="space-y-6">
            {/* Environment Name */}
            <div className="space-y-2">
              <Label htmlFor="environment-name" className="text-sm font-medium text-foreground">
                Environment Name
              </Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="environment-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Staging, Production, Local Sandbox"
                  className="pl-10 bg-background border-input focus-visible:ring-brand text-foreground h-11"
                  autoFocus
                />
              </div>
            </div>

            {/* Environment Mode */}
            <div className="space-y-2">
              <Label htmlFor="environment-type" className="text-sm font-medium text-foreground">
                Environment Mode
              </Label>
              <Select
                value={mode}
                onValueChange={(value) => {
                  const newMode = value as EnvironmentMode;
                  setMode(newMode);
                }}
              >
                <SelectTrigger id="environment-type" className="bg-background border-input text-foreground h-11 focus:ring-brand">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-popover-foreground">
                  <SelectItem value="DEVELOPMENT">Development</SelectItem>
                  <SelectItem value="PRODUCTION" disabled={!productionEnabled}>
                    {productionEnabled
                      ? "Production"
                      : "Production (not enabled yet)"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Blockchain Ecosystem */}
            <div className="space-y-2">
              <Label htmlFor="chain-family" className="text-sm font-medium text-foreground">
                Blockchain Ecosystem
              </Label>
              <Select
                value={chainFamily}
                onValueChange={(value) => setChainFamily(value as ChainFamily)}
              >
                <SelectTrigger id="chain-family" className="bg-background border-input text-foreground h-11 focus:ring-brand">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-popover-foreground">
                  {availableFamilies.map((family) => (
                    <SelectItem key={family.value} value={family.value}>
                      {family.renderLabel()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target Blockchain Network */}
            <div className="space-y-2">
              <Label htmlFor="environment-chain" className="text-sm font-medium text-foreground">
                Target Blockchain Network
              </Label>
              <Select
                value={String(chainId)}
                onValueChange={(value) => setChainId(Number(value))}
              >
                <SelectTrigger id="environment-chain" className="bg-background border-input text-foreground h-11 focus:ring-brand">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-popover-foreground">
                  {chainOptions.map((chain) => (
                    <SelectItem key={chain.chainId} value={String(chain.chainId)}>
                      <span className="flex items-center gap-2">
                        <Web3Icon chainId={chain.chainId} size="sm" />
                        {chain.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {chainOptions.length} {chainOptions.length === 1 ? "network" : "networks"} available in {mode === "DEVELOPMENT" ? "development" : "production"} mode.
              </p>
            </div>

            {/* Wallet linking — shown when ecosystem requires a wallet not yet linked */}
            {needsWallet && (
              <div className="rounded-xl border-2 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {chainFamily === "stellar"
                      ? "Stellar wallet required"
                      : chainFamily === "solana"
                        ? "Solana wallet required"
                        : "EVM wallet required"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {chainFamily === "stellar"
                      ? "Stellar environments need a Stellar wallet linked to your account. Your EVM wallet cannot be used on Stellar networks."
                      : chainFamily === "solana"
                        ? "Solana environments need a Solana wallet (Phantom/Solflare) linked to your account. Your EVM wallet cannot be used on Solana networks."
                        : "EVM environments need an EVM wallet linked to your account. You don't have a linked EVM wallet yet."}
                  </p>
                </div>

                {chainFamily === "stellar" ? (
                  /* ---- Stellar wallet connect ---- */
                  stellarWallet.address ? (
                    <div className="space-y-3">
                      <div className="p-3 rounded-lg bg-brand/5 border border-brand/20">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-foreground">Stellar wallet connected</p>
                            <code className="text-xs font-mono text-muted-foreground break-all">{stellarWallet.address}</code>
                          </div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        className="w-full h-11 bg-brand hover:bg-brand-dark text-primary-foreground"
                        onClick={() => void handleLinkStellarWallet()}
                        disabled={isLinkingWallet}
                      >
                        {isLinkingWallet ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Linking wallet...</>
                        ) : (
                          <><Shield className="mr-2 h-4 w-4" />Sign &amp; Link Stellar Wallet</>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="h-11 w-full bg-brand hover:bg-brand-dark text-primary-foreground rounded-lg flex items-center justify-center gap-2 font-medium disabled:opacity-60"
                      onClick={() => void stellarWallet.connect()}
                      disabled={stellarWallet.isLoading || !stellarWallet.ready}
                    >
                      {!stellarWallet.ready || stellarWallet.isLoading ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />Initializing wallet kit...</>
                      ) : (
                        <><NetworkIcon name="stellar" variant="branded" size={18} className="rounded-full bg-white dark:bg-white p-px" />Connect Stellar wallet</>
                      )}
                    </button>
                  )
                ) : chainFamily === "solana" ? (
                  /* ---- Solana wallet connect ---- */
                  solanaWallet.address ? (
                    <div className="space-y-3">
                      <div className="p-3 rounded-lg bg-brand/5 border border-brand/20">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-foreground">Solana wallet connected</p>
                            <code className="text-xs font-mono text-muted-foreground break-all">{solanaWallet.address}</code>
                          </div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        className="w-full h-11 bg-brand hover:bg-brand-dark text-primary-foreground"
                        onClick={() => void handleLinkSolanaWallet()}
                        disabled={isLinkingWallet}
                      >
                        {isLinkingWallet ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Linking wallet...</>
                        ) : (
                          <><Shield className="mr-2 h-4 w-4" />Sign &amp; Link Solana Wallet</>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="h-11 w-full bg-brand hover:bg-brand-dark text-primary-foreground rounded-lg flex items-center justify-center gap-2 font-medium disabled:opacity-60"
                      onClick={() => void solanaWallet.connect()}
                      disabled={solanaWallet.isLoading}
                    >
                      {solanaWallet.isLoading ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />Connecting...</>
                      ) : (
                        <><NetworkIcon name="solana" variant="branded" size={18} className="rounded-full bg-white dark:bg-white p-px" />Connect Solana wallet</>
                      )}
                    </button>
                  )
                ) : (
                  /* ---- EVM wallet connect ---- */
                  <div className="space-y-3">
                    {isEvmConnected && evmAddress ? (
                      <div className="p-3 rounded-lg bg-brand/5 border border-brand/20">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-foreground">Wallet connected</p>
                            <code className="text-xs font-mono text-muted-foreground">
                              {evmAddress.slice(0, 6)}...{evmAddress.slice(-4)}
                            </code>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {isEvmConnected && !isEvmOnRequired ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-11"
                        onClick={() => void switchToRequiredNetwork()}
                        disabled={isSwitchingChain}
                      >
                        {isSwitchingChain ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Switching network</>
                        ) : (
                          "Switch to a supported network"
                        )}
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      variant={isEvmConnected ? "outline" : "default"}
                      className="w-full h-11 bg-brand hover:bg-brand-dark text-primary-foreground"
                      onClick={() => void openConnectModal()}
                    >
                      <Wallet className="mr-2 h-4 w-4" />
                      {isEvmConnected ? "Change wallet" : "Connect wallet"}
                    </Button>

                    {isEvmConnected && evmAddress && isEvmOnRequired && (
                      <Button
                        type="button"
                        className="w-full h-11 bg-brand hover:bg-brand-dark text-primary-foreground"
                        onClick={() => void handleLinkEvmWallet()}
                        disabled={isLinkingWallet}
                      >
                        {isLinkingWallet ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Linking wallet...</>
                        ) : (
                          <><Shield className="mr-2 h-4 w-4" />Sign &amp; Link Wallet</>
                        )}
                      </Button>
                    )}
                  </div>
                )}

                {stellarWallet.error && (
                  <p className="text-sm text-red-600">{stellarWallet.error}</p>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-500 font-medium mt-6">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-8 border-t border-border mt-10">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/?section=settings&tab=workspace")}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={submitting || !name.trim()}
              className="min-w-[140px] bg-brand hover:bg-brand-dark text-primary-foreground"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Environment"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
