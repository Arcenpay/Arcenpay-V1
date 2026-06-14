"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SkeletonTable, SkeletonMetricGrid, SkeletonList } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Cpu,
  DollarSign,
  Shield,
  Zap,
  Plus,
  Minus,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import {
  useAccount,
  useChainId,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from "wagmi";
import { toast } from "sonner";
import {
  useContractAddresses,
  SessionVaultABI,
  YieldSessionVaultABI,
  getUsdcAddress,
} from "@/lib/contracts";
import {
  formatUsdc,
  truncateAddress,
  formatRelativeTime,
  getBlockExplorerUrl,
  shortHash,
} from "@/lib/format";
import { useEnvironment } from "@/contexts/environment-context";
import { resolveEnvironmentChainId } from "@/lib/default-chain";

interface SessionRow {
  id: string;
  agent: string;
  totalFunded: string;
  totalWithdrawn: string;
  totalSettled: string;
  currentBalance: string;
  settlements: Array<{
    id: string;
    callCount: string;
    settlementAmount: string;
    timestamp: string;
    txHash: string;
  }>;
}

interface ProofRow {
  id: string;
  sessionId: string;
  agentAddress: string;
  callCount: string;
  settlementAmount: string;
  windowStart: string;
  windowEnd: string;
  txHash: string;
  timestamp: string;
}

interface ActiveProofJob {
  sessionId: string;
  status: "pending" | "generating" | "submitting" | "done" | "failed";
  attempts: number;
  callCount: number;
  windowStart: number;
  windowEnd: number;
  nullifier?: string;
  error?: string;
  createdAt: string;
  lastAttemptAt?: string;
}

type SessionsPayload = {
  context: {
    teamId: string;
    environmentMode: "DEVELOPMENT" | "PRODUCTION";
    chainId: number;
  };
  degraded: boolean;
  dependencyHealth: {
    subgraph: "ok" | "unavailable";
    facilitator: "ok" | "unavailable";
  };
  sessions: SessionRow[];
  proofs: ProofRow[];
  activeProofs: {
    count: number;
    jobs: ActiveProofJob[];
    chainMismatch?: { requestedChainId: number; facilitatorChainId: number };
    message?: string;
  };
  runtimeChain?: {
    expectedChainId: number;
    expectedChainName: string;
    rpcEnvKeys: string[];
    subgraphEnvKeys: string[];
  };
};

export function SessionsSection() {
  const { isConnected } = useAccount();
  const { envMode, activeEnvironment, isLoading: envLoading } = useEnvironment();
  const configuredChainId = activeEnvironment?.chainId ?? resolveEnvironmentChainId(envMode);
  const environmentKey = activeEnvironment?.id ?? envMode;
  const contractAddresses = useContractAddresses(configuredChainId);

  const [mounted, setMounted] = useState(false);
  const [payload, setPayload] = useState<SessionsPayload | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  // Deposit dialog state
  const [showDepositDialog, setShowDepositDialog] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositTxHash, setDepositTxHash] = useState<string>("");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const effectiveChainId = configuredChainId;
  const sessionFundingToken = getUsdcAddress(configuredChainId);

  const loadSessionsData = useCallback(async () => {
    if (!mounted || envLoading) return;

    try {
      setSessionsLoading(true);
      setSessionsError(null);
      const params = new URLSearchParams({
        chainId: String(effectiveChainId),
        environmentMode: envMode,
      });
      const res = await fetch(`/api/platform/sessions?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const msg = `Failed to load sessions (${res.status})`;
        setSessionsError(msg);
        setPayload(null);
        return;
      }
      const data = (await res.json()) as SessionsPayload;
      setPayload(data);
    } catch {
      setSessionsError("Failed to load sessions");
      setPayload(null);
    } finally {
      setSessionsLoading(false);
    }
  }, [mounted, envLoading, effectiveChainId, envMode, environmentKey]);

  useEffect(() => {
    if (!mounted || envLoading) return;
    void loadSessionsData();
    const id = setInterval(() => void loadSessionsData(), 30_000);
    return () => clearInterval(id);
  }, [mounted, envLoading, loadSessionsData]);

  const sessions = payload?.sessions ?? [];
  const proofs = payload?.proofs ?? [];
  const activeProofJobs = payload?.activeProofs.jobs ?? [];
  const pendingProofs = payload?.activeProofs.count ?? 0;

  // Stats
  const activeSessions = sessions.filter(
    (s) => BigInt(s.currentBalance) > 0n,
  ).length;
  const totalSettled = sessions.reduce(
    (acc, s) => acc + BigInt(s.totalSettled),
    0n,
  );

  // ── Write: fund session (deposit) ────────────────────────
  const { writeContractAsync: writeFundSession } = useWriteContract();
  const { data: depositReceipt } = useWaitForTransactionReceipt({
    hash: depositTxHash as `0x${string}` | undefined,
    query: { enabled: !!depositTxHash },
  });

  useEffect(() => {
    if (depositReceipt) {
      toast.success("Session funded successfully!");
      setDepositTxHash("");
      setShowDepositDialog(false);
      setDepositAmount("");
      void loadSessionsData();
    }
  }, [depositReceipt, loadSessionsData]);

  // ── Write: withdraw from session ─────────────────────────
  const { writeContractAsync: writeWithdraw } = useWriteContract();

  const handleDeposit = async () => {
    if (!depositAmount || !isConnected) return;
    const amountRaw = BigInt(Math.round(parseFloat(depositAmount) * 1_000_000));
    try {
      const hash = await writeFundSession({
        address: contractAddresses.sessionVault as `0x${string}`,
        abi: SessionVaultABI,
        functionName: "fundSession",
        args: [amountRaw, sessionFundingToken],
      });
      setDepositTxHash(hash);
      toast.info("Transaction submitted...");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Transaction failed");
    }
  };

  const handleWithdraw = async (sessionId: string) => {
    try {
      await writeWithdraw({
        address: contractAddresses.sessionVault as `0x${string}`,
        abi: SessionVaultABI,
        functionName: "withdraw",
        args: [sessionId as `0x${string}`],
      });
      toast.success("Withdrawal initiated");
      void loadSessionsData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Withdrawal failed");
    }
  };

  // ── Read: YieldSessionVault stats ────────────────────────
  const yieldVaultAddress = contractAddresses.yieldSessionVault as
    | `0x${string}`
    | undefined;

  const { data: yieldTotalAssets } = useReadContract({
    address: yieldVaultAddress,
    abi: YieldSessionVaultABI,
    functionName: "totalAssets",
    query: { enabled: !!yieldVaultAddress },
  });

  const { data: yieldStrategy } = useReadContract({
    address: yieldVaultAddress,
    abi: YieldSessionVaultABI,
    functionName: "yieldStrategy",
    query: { enabled: !!yieldVaultAddress },
  });

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const chainId = payload?.context.chainId ?? effectiveChainId;
  const chainMismatch = payload?.activeProofs.chainMismatch;
  const degraded = payload?.degraded ?? false;

  return (
    <div className="space-y-6">
      {mounted && !isConnected && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-warning/5 border border-warning/20 animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-sm text-muted-foreground">
            Wallet is disconnected. Showing workspace default chain data.
          </p>
        </div>
      )}

      {chainMismatch && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-warning/5 border border-warning/20 animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-sm text-muted-foreground">
            {payload?.activeProofs.message ??
              `Proof facilitator is on chain ${chainMismatch.facilitatorChainId} while dashboard is configured for chain ${chainMismatch.requestedChainId}. Proof data may not match on-chain state.`}
          </p>
        </div>
      )}
      {degraded && !chainMismatch && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-warning/5 border border-warning/20 animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-sm text-muted-foreground">
            Some session data sources are temporarily unavailable. Empty proof or session lists may reflect an upstream outage, not a true zero state.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Monitor ZKVUB agent sessions, vault balances, and proof settlements
        </p>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2"
          onClick={() => setShowDepositDialog(true)}
          disabled={!isConnected}
        >
          <Plus className="w-4 h-4" />
          Fund New Session
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sessionsLoading
          ? <SkeletonMetricGrid count={3} />
          : [
              {
                label: "Active Sessions",
                value: activeSessions.toString(),
                icon: Cpu,
                color: "text-chart-1",
              },
              {
                label: "Total Settled",
                value: formatUsdc(totalSettled),
                icon: DollarSign,
                color: "text-accent",
              },
              {
                label: "Pending Proofs",
                value: pendingProofs.toString(),
                icon: Shield,
                color: "text-chart-3",
              },
            ].map((stat, index) => (
              <Card
                key={stat.label}
                className="border-border bg-card hover:border-muted-foreground/30 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4"
                style={{
                  animationDelay: `${index * 75}ms`,
                  animationFillMode: "both",
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {stat.label}
                      </p>
                      <p
                        className={`text-2xl font-semibold mt-1 ${stat.color}`}
                      >
                        {stat.value}
                      </p>
                    </div>
                    <stat.icon className={`w-8 h-8 ${stat.color} opacity-50`} />
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* Error */}
      {sessionsError && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/5 border border-destructive/20">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
          <p className="text-sm text-muted-foreground flex-1">
            {sessionsError}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadSessionsData()}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
      )}

      {/* Sessions Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Agent Address
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Vault Balance
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Total Settled
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Last Settlement
                </th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {sessionsLoading && (
                <tr>
                  <td colSpan={5}>
                    <SkeletonTable rows={3} cols={4} />
                  </td>
                </tr>
              )}
              {!sessionsLoading &&
                sessions.map((session, index) => {
                  const lastSettlement = session.settlements?.[0];
                  return (
                    <tr
                      key={session.id}
                      className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                      style={{ animationDelay: `${index * 40}ms` }}
                    >
                      <td className="py-3 px-4">
                        <code className="text-xs font-mono text-foreground">
                          {truncateAddress(session.agent)}
                        </code>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm font-medium text-foreground">
                          {formatUsdc(BigInt(session.currentBalance))}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-muted-foreground">
                          {formatUsdc(BigInt(session.totalSettled))}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-muted-foreground">
                          {lastSettlement
                            ? formatRelativeTime(
                                parseInt(lastSettlement.timestamp),
                              )
                            : "—"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => void handleWithdraw(session.id)}
                            disabled={!isConnected}
                          >
                            <Minus className="w-3.5 h-3.5 mr-1" />
                            Withdraw
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!sessionsLoading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
              <Zap className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              No active sessions
            </p>
            <p className="text-xs text-muted-foreground max-w-[360px]">
              Agent sessions will appear here once agents fund their session
              vaults and begin making x402 authenticated API calls
            </p>
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
          <span className="text-sm text-muted-foreground">
            Showing {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Active Proof Jobs */}
      {activeProofJobs.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                Active Proof Jobs
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                ZK proof generation in progress
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadSessionsData()}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="space-y-2">
            {activeProofJobs.map((job) => {
              const StatusIcon =
                job.status === "done"
                  ? CheckCircle2
                  : job.status === "failed"
                    ? XCircle
                    : job.status === "generating" || job.status === "submitting"
                      ? Loader2
                      : Clock;
              const statusColor =
                job.status === "done"
                  ? "text-success"
                  : job.status === "failed"
                    ? "text-destructive"
                    : "text-yellow-500";
              return (
                <div
                  key={job.sessionId}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border text-sm"
                >
                  <div className="flex items-center gap-3">
                    <StatusIcon
                      className={`w-4 h-4 shrink-0 ${statusColor} ${
                        job.status === "generating" ||
                        job.status === "submitting"
                          ? "animate-spin"
                          : ""
                      }`}
                    />
                    <div>
                      <p className="text-xs font-mono text-foreground">
                        {shortHash(job.sessionId)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {job.callCount} calls · attempt {job.attempts}
                        {job.error && (
                          <span className="text-destructive ml-1">
                            · {job.error}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className={`text-xs capitalize ${
                      job.status === "done"
                        ? "bg-success/10 text-success border-success/20"
                        : job.status === "failed"
                          ? "bg-destructive/10 text-destructive border-destructive/20"
                          : "bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
                    }`}
                  >
                    {job.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Proof Submission Log */}
      <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-foreground">
            Proof Submission Log
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            History of ZKUsageVerifier.BillingSettled events
          </p>
        </div>

        {sessionsLoading && <SkeletonList items={3} />}

        {!sessionsLoading && proofs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-3">
              <Shield className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              No proof submissions yet
            </p>
            <p className="text-xs text-muted-foreground max-w-[300px]">
              zk-SNARK proof settlements will be logged here
            </p>
          </div>
        )}

        {!sessionsLoading && proofs.length > 0 && (
          <div className="space-y-2">
            {proofs.map((proof) => (
              <div
                key={proof.id}
                className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border text-sm"
              >
                <div className="flex items-center gap-4">
                  <Badge
                    variant="secondary"
                    className="text-xs bg-success/10 text-success border-success/20"
                  >
                    Settled
                  </Badge>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Session{" "}
                      <code className="font-mono">
                        {shortHash(proof.sessionId)}
                      </code>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {proof.callCount} calls ·{" "}
                      {formatRelativeTime(parseInt(proof.timestamp))}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {formatUsdc(BigInt(proof.settlementAmount))}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCopyHash(proof.txHash)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copiedHash === proof.txHash ? (
                        <Check className="w-3 h-3 text-success" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    <a
                      href={getBlockExplorerUrl(chainId, "tx", proof.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Yield Vault Panel — only when YieldSessionVault address is configured */}
      {!yieldVaultAddress && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-secondary/50 border border-border">
          <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Yield Session Vault not configured
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The ERC-4626 yield vault is optional. To enable it, deploy{" "}
              <code className="font-mono">YieldSessionVault.sol</code> and set{" "}
              <code className="font-mono">
                ARCENPAY_CONTRACT_{chainId}_yieldSessionVault
              </code>{" "}
              in your environment.
            </p>
          </div>
        </div>
      )}
      {yieldVaultAddress && (
        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-chart-1" />
                Yield Session Vault
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                ERC-4626 vault generating yield on idle session balances
              </p>
            </div>
            <Badge
              variant="secondary"
              className="text-xs bg-chart-1/10 text-chart-1 border-chart-1/20"
            >
              Live
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg bg-secondary/30 border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Total Assets Under Management
              </p>
              <p className="text-xl font-semibold text-foreground">
                {yieldTotalAssets !== undefined
                  ? formatUsdc(yieldTotalAssets as bigint)
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-secondary/30 border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Yield Strategy Contract
              </p>
              <p className="text-sm font-mono text-foreground break-all">
                {yieldStrategy ? truncateAddress(yieldStrategy as string) : "—"}
              </p>
              {yieldStrategy && (
                <a
                  href={getBlockExplorerUrl(
                    chainId,
                    "address",
                    yieldStrategy as string,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 transition-colors"
                >
                  View on Explorer
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Vault address:{" "}
            <code className="font-mono">
              {truncateAddress(yieldVaultAddress)}
            </code>
            {" · "}Set{" "}
            <code className="font-mono">
              ARCENPAY_CONTRACT_{chainId}_yieldSessionVault
            </code>{" "}
            to configure
          </p>
        </div>
      )}

      {/* Fund Session Dialog */}
      <Dialog open={showDepositDialog} onOpenChange={setShowDepositDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Fund Agent Session</DialogTitle>
            <DialogDescription>
              Deposit USDC to a new SessionVault session. The agent uses this
              balance to pay for API calls via x402.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="depositAmount">Amount (USDC)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="depositAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="50.00"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="bg-secondary border-border pl-6"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Calls SessionVault.fundSession(amount, USDC). Make sure you have
                approved the SessionVault contract to spend your USDC.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDepositDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleDeposit()}
              disabled={!depositAmount || parseFloat(depositAmount) <= 0}
            >
              <Plus className="w-4 h-4 mr-2" />
              Fund Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
