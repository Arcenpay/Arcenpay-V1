"use client";
import { apiFetch } from "@/lib/api-client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Loader2, PlusCircle } from "lucide-react";
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
import Image from "next/image";
import { NetworkIcon } from "@web3icons/react/dynamic";
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
import {
  getOnboardingChainFamily,
  setOnboardingChainFamily,
  resolveEffectiveChainFamily,
} from "@/lib/onboarding-chain-family";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import type { ChainFamily } from "@arcenpay/internal-core";

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

// Chain picker strictly filtered to the selected family:
// EVM users see only EVM networks (BOT/Base/Arc/Sepolia).
// Stellar users see only Stellar networks (Stellar Testnet/Mainnet/Futurenet).
function buildChainOptions(mode: EnvironmentMode, family: ChainFamily) {
  return getChainIdsForEnvironment(mode)
    .filter((chainId) => getChainFamily(chainId) === family)
    .map((chainId) => ({
      chainId,
      label: getChainLabel(chainId),
    }));
}

function defaultChainIdForFamily(
  mode: EnvironmentMode,
  family: ChainFamily,
): number {
  if (mode === "PRODUCTION") {
    if (family === "solana") return SOLANA_MAINNET_CHAIN_ID;
    return BOT_MAINNET_CHAIN_ID;
  }
  if (family === "solana") return SOLANA_DEVNET_CHAIN_ID;
  if (family === "stellar") return STELLAR_TESTNET_CHAIN_ID;
  return BASE_SEPOLIA_CHAIN_ID;
}

export default function EnvironmentOnboardingPage() {
  const router = useRouter();
  const { data, isLoading, refresh } = useDashboardSession();
  const [selectedFamily, setSelectedFamily] = useState<ChainFamily>(() => {
    return getOnboardingChainFamily() ?? "evm";
  });
  const [name, setName] = useState("");
  const [mode, setMode] = useState<EnvironmentMode>("DEVELOPMENT");
  const [chainId, setChainId] = useState<number>(() => {
    return defaultChainIdForFamily("DEVELOPMENT", getOnboardingChainFamily() ?? "evm");
  });
  const [productionEnabled, setProductionEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage =
    data?.currentTeam?.role === "OWNER" || data?.currentTeam?.role === "ADMIN";

  // When session data arrives, ensure family matches the user's linked wallet
  useEffect(() => {
    if (!data?.user) return;
    const resolved = resolveEffectiveChainFamily(
      getOnboardingChainFamily(),
      data.user.walletAddress,
      data.user.stellarWalletAddress,
      data.user.solanaWalletAddress,
    );
    setSelectedFamily(resolved);
    setOnboardingChainFamily(resolved);
  }, [
    data?.user?.walletAddress,
    data?.user?.stellarWalletAddress,
    data?.user?.solanaWalletAddress,
  ]);

  const availableFamilies = useMemo(() => {
    return ALL_CHAIN_FAMILIES.filter(
      (f) => buildChainOptions(mode, f.value).length > 0,
    );
  }, [mode]);

  useEffect(() => {
    if (!availableFamilies.some((f) => f.value === selectedFamily)) {
      const nextFamily = availableFamilies[0]?.value ?? "evm";
      setSelectedFamily(nextFamily);
      setOnboardingChainFamily(nextFamily);
    }
  }, [availableFamilies, selectedFamily]);

  const chainOptions = useMemo(
    () => buildChainOptions(mode, selectedFamily),
    [mode, selectedFamily],
  );
  const existingEnvironments = data?.environments ?? [];
  const hasExistingEnvironments = existingEnvironments.length > 0;

  useEffect(() => {
    if (!chainOptions.some((opt) => opt.chainId === chainId)) {
      setChainId(
        chainOptions[0]?.chainId ?? defaultChainIdForFamily(mode, selectedFamily),
      );
    }
  }, [chainOptions, mode, selectedFamily, chainId]);

  useEffect(() => {
    apiFetch("/api/environments", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { productionEnabled?: boolean } | null) => {
        setProductionEnabled(payload?.productionEnabled === true);
      })
      .catch(() => setProductionEnabled(false));
  }, []);

  async function handleSelect(environmentId: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/environments/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentId }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error || "Failed to select environment");
        return;
      }
      await refresh();
      window.location.assign("/");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreate() {
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
      // A full navigation ensures the server dashboard layout reads the
      // newly activated environment and does not reuse the onboarding route's
      // cached session state.
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
    router.replace("/onboarding/environment/waiting");
    return null;
  }

  return (
    <OnboardingShell
      step={3}
      stepTitle="Launch Workspace"
      stepDescription="Complete the final setup to access your workspace."
    >
      <div className="max-w-lg">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-[28px] font-semibold text-foreground tracking-tight">
              Create Environment
            </h1>
            {hasExistingEnvironments && (
              <span className="text-[10px] font-bold text-brand uppercase tracking-wider bg-brand/5 px-2.5 py-1 rounded-full border border-brand/10">
                Step 3 of 3
              </span>
            )}
          </div>
          <p className="text-base text-muted-foreground mt-3 leading-relaxed">
            Each environment pins this workspace to a specific blockchain network.
          </p>
        </div>

        {hasExistingEnvironments && (
          <div className="mb-8 rounded-xl border border-border bg-card p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-foreground">Use an existing environment</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                This workspace already has an environment. Select it to continue without creating another one.
              </p>
            </div>
            <div className="space-y-2">
              {existingEnvironments.map((environment) => (
                <button
                  key={environment.id}
                  type="button"
                  onClick={() => void handleSelect(environment.id)}
                  disabled={submitting}
                  className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-3 text-left transition-colors hover:border-brand hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{environment.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {environment.mode === "PRODUCTION" ? "Production" : "Development"} · {environment.chainLabel}
                    </span>
                  </span>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-6">
          {hasExistingEnvironments && (
            <div className="border-t border-border pt-8">
              <h2 className="text-base font-semibold text-foreground">Create another environment</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a separate environment only when you need another isolated chain configuration.
              </p>
            </div>
          )}
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

          {/* Mode, Ecosystem & Chain */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="environment-type" className="text-sm font-medium text-foreground">
                Environment Mode
              </Label>
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as EnvironmentMode)}
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

            <div className="space-y-2">
              <Label htmlFor="environment-family" className="text-sm font-medium text-foreground">
                Blockchain Ecosystem
              </Label>
              <Select
                value={selectedFamily}
                onValueChange={(value) => {
                  const fam = value as ChainFamily;
                  setSelectedFamily(fam);
                  setOnboardingChainFamily(fam);
                }}
              >
                <SelectTrigger id="environment-family" className="bg-background border-input text-foreground h-11 focus:ring-brand">
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
          </div>

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

          {/* Info note */}
          <div className="flex items-start gap-3 pt-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-brand shrink-0" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              Only the selected chain will be active inside this environment. Plans, payment links, and checkout flows created here stay pinned to that network.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500 font-medium mt-6">{error}</p>
        )}

        <div className="flex justify-end gap-3 pt-8 border-t border-border mt-10">
          {hasExistingEnvironments && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/?section=settings&tab=workspace", { scroll: false })}
              className="text-muted-foreground hover:text-foreground"
            >
              Back
            </Button>
          )}
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
    </OnboardingShell>
  );
}
