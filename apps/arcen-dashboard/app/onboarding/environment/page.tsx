"use client";

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
import {
  ARC_TESTNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  getChainLabel,
  type EnvironmentMode,
} from "@/lib/default-chain";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";

const CHAINS: Record<EnvironmentMode, Array<{ chainId: number; label: string }>> = {
  DEVELOPMENT: [
    { chainId: BASE_SEPOLIA_CHAIN_ID, label: getChainLabel(BASE_SEPOLIA_CHAIN_ID) },
    { chainId: ARC_TESTNET_CHAIN_ID, label: getChainLabel(ARC_TESTNET_CHAIN_ID) },
  ],
  PRODUCTION: [
    { chainId: BASE_MAINNET_CHAIN_ID, label: getChainLabel(BASE_MAINNET_CHAIN_ID) },
  ],
};

export default function EnvironmentOnboardingPage() {
  const router = useRouter();
  const { data, isLoading, refresh } = useDashboardSession();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<EnvironmentMode>("DEVELOPMENT");
  const [chainId, setChainId] = useState<number>(BASE_SEPOLIA_CHAIN_ID);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage =
    data?.currentTeam?.role === "OWNER" || data?.currentTeam?.role === "ADMIN";

  const chainOptions = useMemo(() => CHAINS[mode], [mode]);
  const hasExistingEnvironments = (data?.environments?.length ?? 0) > 0;

  useEffect(() => {
    setChainId(chainOptions[0]?.chainId ?? BASE_SEPOLIA_CHAIN_ID);
  }, [chainOptions]);

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/environments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          chainId,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error || "Failed to create environment");
        return;
      }
      await refresh();
      router.replace("/");
      router.refresh();
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

          {/* Type & Chain Grid */}
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
                  <SelectItem value="DEVELOPMENT">Development (Testnet-only)</SelectItem>
                  <SelectItem value="PRODUCTION">Production (Mainnet-only)</SelectItem>
                </SelectContent>
              </Select>
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
            </div>
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
            className="min-w-[140px] bg-brand hover:bg-brand-dark text-white"
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
