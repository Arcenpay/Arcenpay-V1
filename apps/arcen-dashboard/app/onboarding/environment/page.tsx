"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Loader2, PlusCircle } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
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
          name,
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
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canManage) {
    router.replace("/onboarding/environment/waiting");
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <div className="grid md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="border-b border-border bg-secondary/40 p-8 md:border-b-0 md:border-r">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Environments</h1>
                <p className="text-sm text-muted-foreground">
                  {hasExistingEnvironments
                    ? "Create another environment for this workspace."
                    : "Create the first environment for this workspace."}
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-3">
              {(data?.environments ?? []).map((environment) => (
                <div
                  key={environment.id}
                  className="rounded-2xl border border-border bg-background/70 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{environment.name}</p>
                      <p className="text-xs text-muted-foreground">{environment.chainLabel}</p>
                    </div>
                    <Badge variant="secondary">
                      {environment.mode === "DEVELOPMENT" ? "DEV" : "PROD"}
                    </Badge>
                  </div>
                </div>
              ))}

              {data?.environments?.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No environments yet.
                </div>
              ) : null}
            </div>
          </div>

          <div className="p-8 md:p-10">
            <div className="flex items-center gap-3">
              <PlusCircle className="h-5 w-5 text-primary" />
              <h2 className="text-3xl font-semibold text-foreground">Create environment</h2>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Each environment locks the workspace to one chain. Development shows testnets only, and production shows mainnets only.
            </p>

            <div className="mt-8 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="environment-name">Environment name</Label>
                <Input
                  id="environment-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Enter environment name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="environment-type">Type</Label>
                <Select
                  value={mode}
                  onValueChange={(value) => setMode(value as EnvironmentMode)}
                >
                  <SelectTrigger id="environment-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEVELOPMENT">Development</SelectItem>
                    <SelectItem value="PRODUCTION">Production</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="environment-chain">Chain</Label>
                <Select
                  value={String(chainId)}
                  onValueChange={(value) => setChainId(Number(value))}
                >
                  <SelectTrigger id="environment-chain">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {chainOptions.map((chain) => (
                      <SelectItem key={chain.chainId} value={String(chain.chainId)}>
                        {chain.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-2xl border border-border bg-secondary/30 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Only the selected chain will be active inside this environment. Plans, payment links, and checkout flows created here stay pinned to that network.
                  </p>
                </div>
              </div>

              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}

              <div className="flex justify-end gap-3">
                {hasExistingEnvironments ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push("/?section=settings&tab=workspace", { scroll: false })}
                  >
                    Back
                  </Button>
                ) : null}
                <Button
                  onClick={() => void handleCreate()}
                  disabled={submitting || !name.trim()}
                  className="min-w-44"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create environment"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
