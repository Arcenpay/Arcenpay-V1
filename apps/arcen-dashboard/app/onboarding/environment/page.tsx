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
    <div className="min-h-screen bg-background flex items-center justify-center p-4 md:p-6 font-sans">
      <div className="w-full max-w-4xl grid md:grid-cols-[280px_1fr] rounded-2xl border border-border bg-card text-card-foreground shadow-lg overflow-hidden">
        
        {/* Left Side: Step Tracker */}
        <div className="border-b border-border bg-muted/40 p-6 md:p-8 md:border-b-0 md:border-r">
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
            Onboarding Setup
          </span>
          <h2 className="mt-1.5 text-lg font-semibold text-foreground">Launch Workspace</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Complete the final setup to access your workspace.
          </p>

          <div className="mt-8 space-y-6">
            {/* Step 1 */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-semibold">
                  ✓
                </div>
                <div className="w-0.5 flex-1 bg-border min-h-8 mt-2" />
              </div>
              <div className="pt-0.5">
                <p className="text-xs font-medium text-muted-foreground">Workspace Wallet</p>
                <p className="text-[11px] text-green-600 dark:text-green-500 mt-0.5 font-medium">Linked successfully</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-semibold">
                  ✓
                </div>
                <div className="w-0.5 flex-1 bg-border min-h-8 mt-2" />
              </div>
              <div className="pt-0.5">
                <p className="text-xs font-medium text-muted-foreground">Provider Profile</p>
                <p className="text-[11px] text-green-600 dark:text-green-500 mt-0.5 font-medium">Profile saved</p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                  3
                </div>
              </div>
              <div className="pt-0.5">
                <p className="text-xs font-semibold text-foreground">Environment</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Launch first environment</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Content & Form */}
        <div className="p-6 md:p-10 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <PlusCircle className="h-5 w-5 text-primary" />
                <h1 className="text-xl font-semibold text-foreground">Create Environment</h1>
              </div>
              {hasExistingEnvironments && (
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20">
                  Step 3 of 3
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Each environment pins this workspace to a specific blockchain network.
            </p>

            <div className="mt-8 space-y-6">
              {/* Environment Name */}
              <div className="space-y-1.5">
                <Label htmlFor="environment-name" className="text-xs font-medium text-foreground">
                  Environment Name
                </Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="environment-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Staging, Production, Local Sandbox"
                    className="pl-9 bg-background border-input text-foreground h-10"
                    autoFocus
                  />
                </div>
              </div>

              {/* Type & Chain Grid */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="environment-type" className="text-xs font-medium text-foreground">
                    Environment Mode
                  </Label>
                  <Select
                    value={mode}
                    onValueChange={(value) => setMode(value as EnvironmentMode)}
                  >
                    <SelectTrigger id="environment-type" className="bg-background border-input text-foreground h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border text-popover-foreground">
                      <SelectItem value="DEVELOPMENT">Development (Testnet-only)</SelectItem>
                      <SelectItem value="PRODUCTION">Production (Mainnet-only)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="environment-chain" className="text-xs font-medium text-foreground">
                    Target Blockchain Network
                  </Label>
                  <Select
                    value={String(chainId)}
                    onValueChange={(value) => setChainId(Number(value))}
                  >
                    <SelectTrigger id="environment-chain" className="bg-background border-input text-foreground h-10">
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

              {/* Informational banner */}
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary shrink-0" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Only the selected chain will be active inside this environment. Plans, payment links, and checkout flows created here stay pinned to that network.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive mt-4 font-semibold">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-6 border-t border-border mt-8">
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
              className="min-w-36"
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
