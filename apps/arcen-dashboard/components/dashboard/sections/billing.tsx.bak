"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SkeletonCard } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Zap,
  Crown,
  Rocket,
  Check,
  X,
  ArrowUpRight,
  Fuel,
  AlertTriangle,
  TrendingUp,
  Users,
  Layers,
  Shield,
  Headphones,
  MessageSquare,
  Wallet,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleDot,
  Circle,
  AlertCircle,
  ExternalLink,
  Clock,
  FileText,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount, useChainId, useSwitchChain, useSendTransaction } from "wagmi";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";


// ── Constants ─────────────────────────────────────────────────────────────────

const ARC_TESTNET_CHAIN_ID = 5042002;

// ── Types ────────────────────────────────────────────────────────────────────

type PlatformBillingReadiness =
  | "NOT_CONFIGURED"
  | "BOOTSTRAP_MISSING"
  | "BOOTSTRAP_FAILED"
  | "READY"
  | "ACTIVE"
  | "PAST_DUE";

type TierLimits = {
  maxWorkspaces: number;
  maxPlans: number;
  maxSubscribers: number;
  maxTeamMembers: number;
  maxFeatureFlags: number;
  maxChains: number;
  maxDevelopmentEnvironments: number;
  maxProductionEnvironments: number;
  platformFeeBps: number;
  gasDailyBudgetUsd: number;
};

type TierFeatures = {
  analytics: boolean;
  webhooks: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  prioritySupport: boolean;
  dedicatedSupport: boolean;
  managedPlanEditing: boolean;
  crossChainBilling: boolean;
  whiteGloveOnboarding: boolean;
};

type TierInfo = {
  tier: string;
  limits: TierLimits;
  pricing: { priceUsdc: number; interval: string };
  features: TierFeatures;
};

type CurrentTier = {
  tier: string;
  expiresAt: string | null;
  limits: TierLimits;
  usage: { plans: number; members: number };
};

type PlatformPlan = {
  tier: string;
  onChainPlanId: string | null;
  syncStatus: string;
  priceMicros: number;
  acceptedToken: string;
  chainId: number;
};

type SubscriptionStatus = {
  status: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  pastDueAt: string | null;
  graceEndsAt: string | null;
  tier: string | null;
  amountMicros: number;
} | null;

type PreparedTxData = {
  chainId: number;
  targetTier: string;
  paymentAccount: string;
  onChainPlanId: string;
  chargeAmountAtomic: string;
  acceptedToken: string;
  merchantAddress: string;
  autopayAddress: string;
  preparedTransactions: {
    install: { target: string; data: string; value: string };
    approve: { target: string; data: string; value: string };
    execute: { target: string; data: string; value: string };
  };
};

type GasBudget = {
  tier: string;
  dailyBudgetUsd: number;
  spentTodayUsd: number;
  remainingUsd: number;
  isGasSponsored: boolean;
  budgetAlertTriggered: boolean;
  txCountToday: number;
};

type GasHistoryEntry = {
  date: string;
  totalUsd: number;
  txCount: number;
};

// ── Upgrade wizard step types ────────────────────────────────────────────────

type UpgradeStep =
  | "review"
  | "connect_wallet"
  | "switch_network"
  | "preparing"
  | "install_autopay"
  | "approve_token"
  | "execute_payment"
  | "confirming"
  | "done"
  | "error";

type TxStepStatus = "pending" | "loading" | "success" | "error" | "skipped";

type TxStepState = {
  install: TxStepStatus;
  approve: TxStepStatus;
  execute: TxStepStatus;
  confirm: TxStepStatus;
};

// ── Tier display config ──────────────────────────────────────────────────────

const TIER_CONFIG = {
  FREE: {
    icon: Zap,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    borderColor: "border-border",
    activeBorder: "border-primary border-2 shadow-sm",
    label: "Free",
    description: "Perfect for starting out and trying ArcenPay",
  },
  PLUS: {
    icon: Crown,
    color: "text-foreground",
    bgColor: "bg-secondary",
    borderColor: "border-border",
    activeBorder: "border-primary border-2 shadow-sm",
    label: "Growth",
    description: "Grow your business with Schematic",
  },
  PRO: {
    icon: Rocket,
    color: "text-foreground",
    bgColor: "bg-secondary",
    borderColor: "border-border",
    activeBorder: "border-primary border-2 shadow-sm",
    label: "Enterprise",
    description: "Support scale and high performance",
  },
};



const DEFAULT_TIER_CONFIG = TIER_CONFIG.FREE;

function getTierConfig(tier: string | null | undefined) {
  return TIER_CONFIG[tier as keyof typeof TIER_CONFIG] ?? DEFAULT_TIER_CONFIG;
}



// ── Readiness banner ─────────────────────────────────────────────────────────

function ReadinessBanner({
  readiness,
  subscription,
}: {
  readiness: PlatformBillingReadiness;
  subscription: SubscriptionStatus;
}) {
  if (readiness === "ACTIVE" || readiness === "READY") return null;

  const bannerConfig: Record<
    PlatformBillingReadiness,
    { icon: React.ElementType; color: string; title: string; body: string } | null
  > = {
    NOT_CONFIGURED: {
      icon: AlertCircle,
      color: "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
      title: "Platform billing not configured",
      body: "The ops signer and treasury address environment variables are not set. Contact your platform admin.",
    },
    BOOTSTRAP_MISSING: {
      icon: AlertCircle,
      color: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
      title: "Platform plans not yet deployed",
      body: "ArcenPay Pro/Enterprise billing plans have not been bootstrapped on Arc testnet. Use the bootstrap button below (OWNER only) or contact support.",
    },
    BOOTSTRAP_FAILED: {
      icon: AlertCircle,
      color: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
      title: "Bootstrap configuration mismatch",
      body: "On-chain plan parameters do not match. Contact ArcenPay support to resolve the configuration mismatch.",
    },
    PAST_DUE: {
      icon: Clock,
      color: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
      title: "Subscription past due",
      body: subscription?.graceEndsAt
        ? `Your subscription renewal failed. Grace period ends ${new Date(subscription.graceEndsAt).toLocaleDateString()}. Update your payment method to avoid downgrade.`
        : "Your subscription renewal failed. Please update your payment method.",
    },
    ACTIVE: null,
    READY: null,
  };

  const config = bannerConfig[readiness];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${config.color}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">{config.title}</p>
        <p className="text-xs mt-0.5 opacity-80">{config.body}</p>
      </div>
    </div>
  );
}

// ── Tx step indicator ─────────────────────────────────────────────────────────

function TxStepRow({
  label,
  description,
  status,
}: {
  label: string;
  description: string;
  status: TxStepStatus;
}) {
  const isPending = status === "pending";
  const isLoading = status === "loading";
  const isSuccess = status === "success";
  const isError = status === "error";

  return (
    <div
      className={`flex items-start gap-4 p-3 rounded-lg border transition-all duration-300 ${
        isLoading
          ? "border-primary bg-primary/5"
          : isSuccess
            ? "border-border bg-muted/40"
            : "border-border bg-card"
      }`}
    >
      <div className="mt-0.5 shrink-0">
        {isSuccess ? (
          <div className="w-5 h-5 rounded-full bg-secondary border border-border flex items-center justify-center">
            <CircleCheck className="w-3.5 h-3.5 text-foreground" />
          </div>
        ) : isLoading ? (
          <div className="w-5 h-5 rounded-full bg-secondary border border-primary flex items-center justify-center">
            <RefreshCw className="w-3 h-3 text-primary animate-spin" />
          </div>
        ) : isError ? (
          <div className="w-5 h-5 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center">
            <AlertCircle className="w-3.5 h-3.5 text-destructive" />
          </div>
        ) : status === "skipped" ? (
          <div className="w-5 h-5 rounded-full bg-muted border border-border flex items-center justify-center opacity-40">
            <CircleCheck className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        ) : (
          <div className="w-5 h-5 rounded-full border border-border flex items-center justify-center">
            <Circle className="w-3 h-3 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="space-y-0.5 min-w-0">
        <p
          className={`text-xs font-semibold tracking-wide uppercase ${
            isLoading
              ? "text-primary"
              : isSuccess
                ? "text-foreground"
                : isError
                  ? "text-destructive"
                  : "text-muted-foreground"
          }`}
        >
          {label}
        </p>
        <p className="text-xs text-muted-foreground truncate leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}


// ── Main Upgrade Wizard ──────────────────────────────────────────────────────

function UpgradeWizard({
  open,
  onOpenChange,
  selectedTier,
  currentTier,
  allTiers,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedTier: string | null;
  currentTier: CurrentTier | null;
  allTiers: TierInfo[];
  onSuccess: () => void;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();

  const [step, setStep] = useState<UpgradeStep>("review");
  const [preparedData, setPreparedData] = useState<PreparedTxData | null>(null);
  const [txSteps, setTxSteps] = useState<TxStepState>({
    install: "pending",
    approve: "pending",
    execute: "pending",
    confirm: "pending",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [executeTxHash, setExecuteTxHash] = useState<string | null>(null);

  const tierInfo = allTiers.find((t) => t.tier === selectedTier);
  const config = getTierConfig(selectedTier);

  const isUpgrade =
    ["FREE", "PLUS", "PRO"].indexOf(selectedTier ?? "FREE") >
    ["FREE", "PLUS", "PRO"].indexOf(currentTier?.tier ?? "FREE");

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep("review");
      setPreparedData(null);
      setTxSteps({ install: "pending", approve: "pending", execute: "pending", confirm: "pending" });
      setErrorMessage(null);
      setExecuteTxHash(null);
    }
  }, [open]);

  function setTxStep(key: keyof TxStepState, status: TxStepStatus) {
    setTxSteps((prev) => ({ ...prev, [key]: status }));
  }

  async function handleStart() {
    if (!isConnected) {
      setStep("connect_wallet");
      return;
    }
    if (chainId !== ARC_TESTNET_CHAIN_ID) {
      setStep("switch_network");
      return;
    }
    await fetchPreparedData();
  }

  async function handleConnected() {
    if (chainId !== ARC_TESTNET_CHAIN_ID) {
      setStep("switch_network");
    } else {
      await fetchPreparedData();
    }
  }

  async function handleNetworkSwitch() {
    try {
      await switchChain({ chainId: ARC_TESTNET_CHAIN_ID });
      await fetchPreparedData();
    } catch (e) {
      setErrorMessage(`Network switch failed: ${e instanceof Error ? e.message : String(e)}`);
      setStep("error");
    }
  }

  async function fetchPreparedData() {
    if (!address || !selectedTier) return;
    setStep("preparing");

    try {
      const res = await fetch("/api/platform/tier/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTier: selectedTier, paymentAccount: address }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.message ?? data.error ?? "Prepare failed");
      }

      setPreparedData(data.data);
      setStep("install_autopay");
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }

  async function handleInstallAutopay() {
    if (!preparedData) return;
    setTxStep("install", "loading");

    try {
      await sendTransactionAsync({
        to: preparedData.preparedTransactions.install.target as `0x${string}`,
        data: preparedData.preparedTransactions.install.data as `0x${string}`,
        value: BigInt(0),
      });
      setTxStep("install", "success");
      setStep("approve_token");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Module already installed is non-fatal
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("installed")) {
        setTxStep("install", "skipped");
        setStep("approve_token");
      } else {
        setTxStep("install", "error");
        setErrorMessage(`Install failed: ${msg}`);
        setStep("error");
      }
    }
  }

  async function handleApproveToken() {
    if (!preparedData) return;
    setTxStep("approve", "loading");

    try {
      await sendTransactionAsync({
        to: preparedData.preparedTransactions.approve.target as `0x${string}`,
        data: preparedData.preparedTransactions.approve.data as `0x${string}`,
        value: BigInt(0),
      });
      setTxStep("approve", "success");
      setStep("execute_payment");
    } catch (e) {
      setTxStep("approve", "error");
      setErrorMessage(`Token approval failed: ${e instanceof Error ? e.message : String(e)}`);
      setStep("error");
    }
  }

  async function handleExecutePayment() {
    if (!preparedData) return;
    setTxStep("execute", "loading");

    try {
      const txHash = await sendTransactionAsync({
        to: preparedData.preparedTransactions.execute.target as `0x${string}`,
        data: preparedData.preparedTransactions.execute.data as `0x${string}`,
        value: BigInt(0),
      });
      setTxStep("execute", "success");
      setExecuteTxHash(txHash);
      setStep("confirming");
      await handleConfirm(txHash, preparedData.paymentAccount);
    } catch (e) {
      setTxStep("execute", "error");
      setErrorMessage(`Payment execution failed: ${e instanceof Error ? e.message : String(e)}`);
      setStep("error");
    }
  }

  async function handleConfirm(txHash: string, paymentAccount: string) {
    setTxStep("confirm", "loading");

    try {
      const res = await fetch("/api/platform/tier/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetTier: selectedTier,
          paymentAccount,
          txHash,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.message ?? data.error ?? "Confirmation failed");
      }

      setTxStep("confirm", "success");
      setStep("done");
    } catch (e) {
      setTxStep("confirm", "error");
      setErrorMessage(
        `Backend confirmation failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      setStep("error");
    }
  }

  const priceUsdc = tierInfo?.pricing.priceUsdc ?? 0;
  const Icon = config.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <div className={`p-1.5 rounded-lg ${config.bgColor}`}>
              <Icon className={`w-4 h-4 ${config.color}`} />
            </div>
            Upgrade to {config.label}
          </DialogTitle>
          <DialogDescription>
            {step === "review" && (
              <>
                Subscribe to ArcenPay {config.label} for{" "}
                <span className="font-semibold text-foreground">${priceUsdc}/month USDC</span> via on-chain autopay on Arc testnet.
              </>
            )}
            {step === "connect_wallet" && "Connect your wallet to proceed."}
            {step === "switch_network" && "Switch to Arc testnet to proceed."}
            {step === "preparing" && "Fetching prepared transaction data…"}
            {(step === "install_autopay" ||
              step === "approve_token" ||
              step === "execute_payment") && (
              <>Submit transactions in your wallet to activate the subscription.</>
            )}
            {step === "confirming" && "Verifying your payment on-chain…"}
            {step === "done" && "Your subscription is now active!"}
            {step === "error" && "Something went wrong. See details below."}
          </DialogDescription>
        </DialogHeader>

        {/* Step content */}
        <div className="space-y-4 py-2">
          {/* Active Wallet Banner */}
          {isConnected && address && (step !== "connect_wallet" && step !== "switch_network") && (
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/40 text-sm">
              <span className="text-muted-foreground font-medium">Wallet</span>
              <div className="flex items-center gap-1.5 font-mono text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span>
                  {address.slice(0, 6)}...{address.slice(-4)}
                </span>
              </div>
            </div>
          )}

          {/* Review */}
          {step === "review" && (
            <div className="rounded-lg border p-4 space-y-2.5 text-sm bg-card">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-medium">ArcenPay {config.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Price</span>
                <span className="font-medium">${priceUsdc} USDC / month</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Network</span>
                <span className="font-medium">Arc Testnet (5042002)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment method</span>
                <span className="font-medium flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 opacity-60" />
                  Autopay (ERC-7579)
                </span>
              </div>
              <div className="border-t pt-2 text-xs text-muted-foreground">
                You'll submit 3 wallet transactions: install autopay module, approve USDC,
                then execute the first payment.
              </div>
            </div>
          )}

          {/* Connect wallet */}
          {step === "connect_wallet" && (
            <div className="flex flex-col items-center gap-4 py-6 border bg-muted/20 rounded-lg">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Wallet className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="text-center space-y-1 px-4">
                <p className="text-sm font-semibold">Wallet connection required</p>
                <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">
                  Connect your wallet using the button in the header, then return here.
                </p>
              </div>
              <Button
                onClick={handleConnected}
                disabled={!isConnected}
                className="w-[80%]"
              >
                {isConnected ? "Continue" : "Waiting for wallet…"}
              </Button>
            </div>
          )}

          {/* Switch network */}
          {step === "switch_network" && (
            <div className="flex flex-col items-center gap-4 py-6 border bg-muted/20 rounded-lg">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div className="text-center space-y-1 px-4">
                <p className="text-sm font-semibold">Switch Network required</p>
                <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">
                  Your wallet is on chain ID <strong>{chainId}</strong>. Please switch to{" "}
                  <strong>Arc Testnet (5042002)</strong>.
                </p>
              </div>
              <Button onClick={handleNetworkSwitch} className="w-[80%]">
                Switch to Arc Testnet
              </Button>
            </div>
          )}

          {/* Preparing */}
          {step === "preparing" && (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Preparing transaction data…</p>
            </div>
          )}

          {/* Tx steps */}
          {(step === "install_autopay" ||
            step === "approve_token" ||
            step === "execute_payment" ||
            step === "confirming" ||
            step === "done" ||
            step === "error") && (
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-muted-foreground px-1">Transaction Steps</p>
              <div className="space-y-2">
                <TxStepRow
                  label="1. Install Autopay Module"
                  description="Enable ERC-7579 autopay on your smart account"
                  status={txSteps.install}
                />
                <TxStepRow
                  label="2. Approve USDC"
                  description={`Allow AutopayModule to spend ${priceUsdc * 13} USDC`}
                  status={txSteps.approve}
                />
                <TxStepRow
                  label="3. Execute First Payment"
                  description={`Send ${priceUsdc} USDC to ArcenPay treasury`}
                  status={txSteps.execute}
                />
                <TxStepRow
                  label="4. Confirm On-Chain"
                  description="Backend verifies transaction and activates tier"
                  status={txSteps.confirm}
                />
              </div>
            </div>
          )}

          {/* Error message */}
          {step === "error" && errorMessage && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-xs text-destructive leading-relaxed font-mono">
              {errorMessage}
            </div>
          )}



          {/* Done */}
          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <CircleCheck className="w-6 h-6 text-green-500" />
              </div>
              <p className="text-sm font-medium text-center">
                Welcome to ArcenPay {config.label}!
              </p>
              {executeTxHash && (
                <a
                  href={`https://testnet.arcscan.app/tx/${executeTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  View transaction <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {step === "review" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleStart}>
                <Wallet className="w-4 h-4 mr-1.5" />
                Start Upgrade
              </Button>
            </>
          )}

          {step === "install_autopay" && (
            <Button className="w-full" onClick={handleInstallAutopay}>
              Sign Transaction 1
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}

          {step === "approve_token" && (
            <Button className="w-full" onClick={handleApproveToken}>
              Sign Transaction 2
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}

          {step === "execute_payment" && (
            <Button className="w-full" onClick={handleExecutePayment}>
              Sign Transaction 3 — Pay ${priceUsdc} USDC
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}

          {step === "done" && (
            <Button
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                onSuccess();
              }}
            >
              <Check className="w-4 h-4 mr-1.5" />
              Done
            </Button>
          )}

          {step === "error" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  setStep("review");
                  setTxSteps({ install: "pending", approve: "pending", execute: "pending", confirm: "pending" });
                  setErrorMessage(null);
                }}
              >
                <RefreshCw className="w-4 h-4 mr-1.5" />
                Retry
              </Button>
            </>
          )}

          {(step === "preparing" || step === "confirming") && (
            <Button disabled className="w-full">
              <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
              {step === "preparing" ? "Loading…" : "Confirming…"}
            </Button>
          )}
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

// ── Downgrade Dialog ─────────────────────────────────────────────────────────

function DowngradeDialog({
  open,
  onOpenChange,
  selectedTier,
  currentTier,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedTier: string | null;
  currentTier: CurrentTier | null;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleDowngrade() {
    if (!selectedTier) return;
    setLoading(true);

    try {
      const res = await fetch("/api/platform/tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTier: selectedTier }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        toast.success(data.message ?? "Downgraded successfully.");
        onOpenChange(false);
        onSuccess();
      } else if (res.status === 409) {
        const violations = (data.violations ?? []) as string[];
        toast.error(
          violations.length > 0
            ? violations.join(" | ")
            : data.message ?? "Cannot downgrade due to usage limits.",
        );
      } else {
        toast.error(data.message ?? data.error ?? "Downgrade failed.");
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Downgrade to {getTierConfig(selectedTier).label}</DialogTitle>
          <DialogDescription>
            Downgrading will reduce your limits immediately. Make sure your current usage is
            within the target tier's limits.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDowngrade} disabled={loading}>
            {loading ? "Downgrading…" : "Confirm Downgrade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TIER_FEATURES_LIST: Record<string, string[]> = {
  FREE: [
    "Dapps / Applications linked: 1",
    "Webhooks: 1 endpoint (all events, HMAC-SHA256 signed)",
    "Payment links: Up to 3 active links",
    "SDK access: 1 API key (Node + React SDK)",
    "Plans: Up to 3 active plans",
    "Subscribers: Up to 200",
    "Chains: 1 chain",
    "Environments: 2 dev + 2 prod",
    "Team members: 3",
    "Feature flags: 5 (boolean only)",
    "Billing intervals: Monthly only",
    "Zk settlement (ZKVUB): Yes",
    "Agent payments (x402): Yes",
    "Add-ons: Not available",
    "Credit types: Not available",
    "Coupons: Not available",
    "Usage metering: Not available",
    "Custom branding: No",
    "Support: Community",
    "Platform fee: 2.0%",
  ],
  PLUS: [
    "Everything in Free, plus:",
    "Dapps / Applications linked: 10",
    "Webhooks: Unlimited endpoints (per-event preferences)",
    "Payment links: Up to 50 active links",
    "SDK access: Multiple API keys",
    "Plans: Up to 15 active plans",
    "Subscribers: Up to 50,000",
    "Chains: Unlimited",
    "Environments: 10 dev + 10 prod",
    "Team members: 10",
    "Feature flags: 999 (all types: boolean, event_based, trait_based)",
    "Billing intervals: Monthly + Annual",
    "Zk settlement (ZKVUB): Yes",
    "Agent payments (x402): Yes",
    "Coupons: Up to 10 active coupons",
    "Add-ons: Up to 10 active add-ons",
    "Credit types: Up to 5 active credit types",
    "Usage metering & credit-burn: Yes",
    "Custom branding: Yes",
    "ISO 20022 export: Yes",
    "Support: Priority email",
    "Platform fee: 1.0%",
  ],
  PRO: [
    "Everything in Growth, plus:",
    "Dapps / Applications linked: Unlimited",
    "Webhooks: Unlimited endpoints",
    "Payment links: Unlimited",
    "SDK access: Unlimited keys + Agent SDK",
    "Plans: Unlimited",
    "Subscribers: Unlimited",
    "Chains: Unlimited",
    "Environments: Unlimited",
    "Team members: Unlimited",
    "Feature flags: Unlimited (all types)",
    "Coupons: Unlimited",
    "Add-ons: Unlimited",
    "Credit types: Unlimited",
    "Usage metering & credit-burn: Yes",
    "Custom branding: Full whitelabel",
    "Agent payments (x402 protocol): Yes",
    "ZK settlement (ZKVUB): Yes",
    "Cross-chain mirroring (Axelar + CCIP): Yes",
    "Tableland + Lit Protocol integration: Yes",
    "Support: Dedicated + white-glove onboarding",
    "Platform fee: 0.5%",
  ],
};

// ── Main Component ────────────────────────────────────────────────────────────

export function BillingSection() {
  const [expandedTiers, setExpandedTiers] = useState<Record<string, boolean>>({});
  const [currentTier, setCurrentTier] = useState<CurrentTier | null>(null);
  const [allTiers, setAllTiers] = useState<TierInfo[]>([]);
  const [gasBudget, setGasBudget] = useState<GasBudget | null>(null);
  const [gasHistory, setGasHistory] = useState<GasHistoryEntry[]>([]);
  const [billingReadiness, setBillingReadiness] = useState<PlatformBillingReadiness>("READY");
  const [platformPlans, setPlatformPlans] = useState<PlatformPlan[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionStatus>(null);
  const [platformInvoices, setPlatformInvoices] = useState<any[]>([]);
  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [downgradeDialogOpen, setDowngradeDialogOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");

  const fetchData = useCallback(async () => {
    try {
      const [tierRes, gasRes, invoicesRes] = await Promise.all([
        fetch("/api/platform/tier"),
        fetch("/api/platform/gas-budget?days=7"),
        fetch("/api/platform/invoices"),
      ]);

      if (tierRes.ok) {
        const data = await tierRes.json();
        setCurrentTier(data.current);
        setAllTiers(data.allTiers);
        setBillingReadiness(data.billingReadiness ?? "READY");
        setPlatformPlans(data.platformPlans ?? []);
        setSubscription(data.subscription ?? null);
      }

      if (gasRes.ok) {
        const data = await gasRes.json();
        setGasBudget(data.budget);
        setGasHistory(data.history);
      }

      if (invoicesRes.ok) {
        const data = await invoicesRes.json();
        setPlatformInvoices(data.invoices ?? []);
      }
    } catch {
      toast.error("Failed to load billing data");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDownloadInvoice = async (invoiceId: string) => {
    setBusyInvoiceId(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/download`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Download unavailable");
      const url = data.downloadUrl as string | undefined;
      if (!url) throw new Error("Download URL unavailable");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusyInvoiceId(null);
    }
  };


  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleBootstrap() {
    setBootstrapping(true);
    try {
      const res = await fetch("/api/platform/tier/bootstrap", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success("Platform billing plans bootstrapped successfully.");
        fetchData();
      } else {
        toast.error(data.message ?? data.error ?? "Bootstrap failed.");
      }
    } catch {
      toast.error("Network error during bootstrap.");
    } finally {
      setBootstrapping(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonCard lines={5} />
        <SkeletonCard lines={5} />
        <SkeletonCard lines={5} />
      </div>
    );
  }

  const tierOrder = ["FREE", "PLUS", "PRO"];
  const currentTierIndex = tierOrder.indexOf(currentTier?.tier ?? "FREE");

  const upgradesBlocked =
    billingReadiness === "NOT_CONFIGURED" ||
    billingReadiness === "BOOTSTRAP_MISSING" ||
    billingReadiness === "BOOTSTRAP_FAILED";

  const isUpgradeSelected =
    selectedTier !== null &&
    tierOrder.indexOf(selectedTier) > currentTierIndex;

  return (
    <div className="space-y-6">
      {/* Readiness banner */}
      <ReadinessBanner readiness={billingReadiness} subscription={subscription} />

      {/* Bootstrap button — show when plans are missing/failed */}
      {(billingReadiness === "BOOTSTRAP_MISSING" || billingReadiness === "BOOTSTRAP_FAILED") && (
        <div className="flex items-center justify-between px-4 py-3 rounded-lg border bg-muted/30">
          <div>
            <p className="text-sm font-medium">Bootstrap Platform Plans</p>
            <p className="text-xs text-muted-foreground">
              Deploy PLUS/PRO plans to Arc testnet via the ops signer (OWNER only)
            </p>
          </div>
          <Button size="sm" onClick={handleBootstrap} disabled={bootstrapping}>
            {bootstrapping ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Bootstrapping…
              </>
            ) : (
              "Bootstrap Now"
            )}
          </Button>
        </div>
      )}

      {/* Current Plan Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {currentTier &&
              (() => {
                const config = getTierConfig(currentTier.tier);
                const Icon = config.icon;
                return <Icon className={`w-5 h-5 ${config.color}`} />;
              })()}
            Current Plan:{" "}
            {getTierConfig(currentTier?.tier).label}
            {/* Subscription status pill */}
            {subscription?.status === "ACTIVE" && (
              <Badge variant="outline" className="text-[10px] text-green-600 border-green-500/30 bg-green-500/10">
                Active
              </Badge>
            )}
            {subscription?.status === "PAST_DUE" && (
              <Badge variant="destructive" className="text-[10px]">
                <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                Past Due
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {currentTier?.expiresAt
              ? `Renews ${new Date(currentTier.expiresAt).toLocaleDateString()}`
              : "No expiration"}
            {subscription?.currentPeriodEnd && (
              <span className="ml-2 text-muted-foreground/60">
                · Period ends {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <UsageMeter
              label="Plans"
              current={currentTier?.usage.plans ?? 0}
              max={currentTier?.limits.maxPlans ?? 1}
              icon={Layers}
            />
            <UsageMeter
              label="Team Members"
              current={currentTier?.usage.members ?? 0}
              max={currentTier?.limits.maxTeamMembers ?? 1}
              icon={Users}
            />
            <div className="rounded-lg border p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Platform Fee</p>
              <p className="text-lg font-semibold">
                {((currentTier?.limits.platformFeeBps ?? 200) / 100).toFixed(1)}
                %
              </p>
              <p className="text-[10px] text-muted-foreground">
                per transaction
              </p>
            </div>
            <div className="rounded-lg border p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Environments</p>
              <p className="text-lg font-semibold">
                {currentTier?.limits.maxDevelopmentEnvironments === 999 ||
                currentTier?.limits.maxProductionEnvironments === 999
                  ? "Unlimited"
                  : `${currentTier?.limits.maxDevelopmentEnvironments ?? 2} dev / ${currentTier?.limits.maxProductionEnvironments ?? 2} prod`}
              </p>
              <p className="text-[10px] text-muted-foreground">workspace slots</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Gas Budget Widget */}
      {gasBudget && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fuel className="w-5 h-5 text-foreground" />
              Gas Sponsorship
              {gasBudget.budgetAlertTriggered && (
                <Badge variant="destructive" className="text-[10px]">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Budget Low
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Your platform covers gas fees for subscriber transactions on L2
              chains
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Today&apos;s Spend
                </p>
                <p className="text-2xl font-bold">
                  ${gasBudget.spentTodayUsd.toFixed(4)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    / ${gasBudget.dailyBudgetUsd.toFixed(2)}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Transactions</p>
                <p className="text-2xl font-bold">{gasBudget.txCountToday}</p>
              </div>
            </div>

            <div className="space-y-1">
              <Progress
                value={
                  gasBudget.dailyBudgetUsd > 0
                    ? (gasBudget.spentTodayUsd / gasBudget.dailyBudgetUsd) * 100
                    : 0
                }
                className="h-2"
              />
              <p className="text-[10px] text-muted-foreground text-right">
                ${gasBudget.remainingUsd.toFixed(4)} remaining
              </p>
            </div>

            {/* 7-day sparkline */}
            {gasHistory.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-2">
                  Last 7 days
                </p>
                <div className="flex items-end gap-1 h-12">
                  {gasHistory.map((entry, i) => {
                    const max = Math.max(
                      ...gasHistory.map((e) => e.totalUsd),
                      0.01,
                    );
                    const height = Math.max((entry.totalUsd / max) * 100, 4);
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-orange-500/20 hover:bg-orange-500/40 rounded-t transition-colors cursor-default"
                        style={{ height: `${height}%` }}
                        title={`${entry.date}: $${entry.totalUsd.toFixed(4)} (${entry.txCount} txs)`}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tier Comparison */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Compare Plans</h3>
          {/* Monthly / Yearly toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-secondary border border-border">
            <button
              onClick={() => setBillingInterval("monthly")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-all duration-200 ${
                billingInterval === "monthly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingInterval("yearly")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-all duration-200 ${
                billingInterval === "yearly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Yearly
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-secondary text-foreground dark:text-foreground">
                -20%
              </span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {allTiers.map((tierInfo) => {
            const config = getTierConfig(tierInfo.tier);
            const Icon = config.icon;
            const tierIndex = tierOrder.indexOf(tierInfo.tier);
            const isCurrent = tierInfo.tier === currentTier?.tier;
            const isUpgrade = tierIndex > currentTierIndex;
            const isDowngrade = tierIndex < currentTierIndex;
            const isPaidTier = tierInfo.tier !== "FREE";

            const isFree = tierInfo.tier === "FREE";
            const isGrowth = tierInfo.tier === "PLUS";
            const isEnterprise = tierInfo.tier === "PRO";

            const displayPriceString = isFree
              ? "Free"
              : isGrowth
                ? billingInterval === "yearly"
                  ? "$7.99"
                  : "$9.99"
                : billingInterval === "yearly"
                  ? "$399"
                  : "$499";

            const monthlyPriceString = isFree
              ? ""
              : isGrowth
                ? "$9.99"
                : "$499";

            const yearlyTotalString = isGrowth
              ? "Billed $95/yr"
              : isEnterprise
                ? "Billed $4,788/yr"
                : "";

            const features = TIER_FEATURES_LIST[tierInfo.tier] ?? [];
            const isExpanded = expandedTiers[tierInfo.tier] || false;
            const visibleFeatures = isExpanded ? features : features.slice(0, 5);

            return (
              <Card
                key={tierInfo.tier}
                className={`relative flex flex-col ${
                  isCurrent ? config.activeBorder : config.borderColor
                }`}
              >
                {isCurrent && (
                  <Badge
                    className="absolute -top-2.5 left-4 text-[10px]"
                    variant="default"
                  >
                    Current Plan
                  </Badge>
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${config.bgColor}`}>
                      <Icon className={`w-5 h-5 ${config.color}`} />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{config.label}</CardTitle>
                      <CardDescription className="text-xs">
                        {config.description}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="pt-2 flex items-end gap-1">
                    <span className="text-3xl font-bold">{displayPriceString}</span>
                    {!isFree && (
                      <span className="text-sm text-muted-foreground mb-0.5">
                        /mo
                      </span>
                    )}
                    {!isFree && billingInterval === "yearly" && (
                      <span className="text-xs text-muted-foreground line-through mb-0.5 ml-1">
                        {monthlyPriceString}
                      </span>
                    )}
                  </div>
                  {!isFree && billingInterval === "yearly" && (
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      {yearlyTotalString}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
                  {/* Features list */}
                  <div className="space-y-2 border-t pt-3 border-border">
                    {visibleFeatures.map((feature, idx) => {
                      const isHeader = feature.endsWith("plus:");
                      return (
                        <div
                          key={idx}
                          className={`flex items-start gap-2 text-sm ${
                            isHeader ? "font-semibold text-foreground pt-1.5" : "text-muted-foreground"
                          }`}
                        >
                          {!isHeader && (
                            <Check className="w-3.5 h-3.5 text-foreground shrink-0 mt-0.5" />
                          )}
                          <span>{feature}</span>
                        </div>
                      );
                    })}

                    {features.length > 5 && (
                      <button
                        onClick={() =>
                          setExpandedTiers((prev) => ({
                            ...prev,
                            [tierInfo.tier]: !prev[tierInfo.tier],
                          }))
                        }
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium pt-1.5 transition-colors"
                      >
                        {isExpanded ? (
                          <>
                            <span>Show less</span>
                            <ChevronUp className="w-3.5 h-3.5" />
                          </>
                        ) : (
                          <>
                            <span>Show {features.length - 5} more features</span>
                            <ChevronDown className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Action Button */}
                  <div className="pt-2">
                    {isCurrent ? (
                      <Button variant="outline" className="w-full" disabled>
                        Current Plan
                      </Button>
                    ) : isUpgrade && isPaidTier ? (
                      <Button
                        className="w-full"
                        disabled={upgradesBlocked}
                        onClick={() => {
                          setSelectedTier(tierInfo.tier);
                          setUpgradeDialogOpen(true);
                        }}
                        title={
                          upgradesBlocked
                            ? "Platform billing plans not yet bootstrapped"
                            : undefined
                        }
                      >
                        <ArrowUpRight className="w-4 h-4 mr-1" />
                        Upgrade to {config.label}
                        {upgradesBlocked && (
                          <AlertTriangle className="w-3.5 h-3.5 ml-1.5 opacity-70" />
                        )}
                      </Button>
                    ) : isDowngrade ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setSelectedTier(tierInfo.tier);
                          setDowngradeDialogOpen(true);
                        }}
                      >
                        Downgrade to {config.label}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Billing History / Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-foreground" />
            Billing History & Receipts
          </CardTitle>
          <CardDescription>
            Download receipts and invoices for your platform subscription charges.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {platformInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-sm text-muted-foreground">
              <FileText className="w-8 h-8 mb-2 text-muted-foreground/30" />
              No invoices found. Upgrade to Pro/Enterprise to get started.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice Number</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {platformInvoices.map((invoice) => {
                    const metadata = invoice.metadata && typeof invoice.metadata === "object" ? invoice.metadata as Record<string, unknown> : {};
                    const tierLabel = metadata.tier === "PRO" ? "Enterprise" : metadata.tier === "PLUS" ? "Pro" : "Free";
                    const formattedDate = new Date(invoice.issuedAt || invoice.createdAt).toLocaleDateString();

                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono text-xs">{invoice.number || "—"}</TableCell>
                        <TableCell>{formattedDate}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-semibold text-xs">
                            {tierLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          ${Number(invoice.total).toFixed(2)} {invoice.currency}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-green-600 border-green-500/30 bg-green-500/10 font-semibold text-[10px]">
                            {invoice.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyInvoiceId === invoice.id}
                            onClick={() => handleDownloadInvoice(invoice.id)}
                            className="h-8 px-2 flex items-center gap-1.5 ml-auto text-xs text-muted-foreground hover:text-foreground"
                          >
                            {busyInvoiceId === invoice.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            Receipt
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upgrade Wizard Dialog */}
      <UpgradeWizard
        open={upgradeDialogOpen}
        onOpenChange={setUpgradeDialogOpen}
        selectedTier={selectedTier}
        currentTier={currentTier}
        allTiers={allTiers}
        onSuccess={() => {
          toast.success("Tier activated!");
          fetchData();
        }}
      />

      {/* Downgrade Dialog */}
      <DowngradeDialog
        open={downgradeDialogOpen}
        onOpenChange={setDowngradeDialogOpen}
        selectedTier={selectedTier}
        currentTier={currentTier}
        onSuccess={() => {
          fetchData();
        }}
      />
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function UsageMeter({
  label,
  current,
  max,
  icon: Icon,
}: {
  label: string;
  current: number;
  max: number;
  icon: React.ElementType;
}) {
  const percent = max > 0 ? (current / max) * 100 : 0;
  const isNearLimit = percent >= 80;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="text-lg font-semibold">
        {current}
        <span className="text-sm font-normal text-muted-foreground">
          {" "}
          / {max === 999 ? "\u221E" : max}
        </span>
      </p>
      <Progress
        value={Math.min(percent, 100)}
        className={`h-1.5 ${isNearLimit ? "[&>div]:bg-destructive" : ""}`}
      />
    </div>
  );
}

function LimitRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value >= 999 ? "Unlimited" : value}</span>
    </div>
  );
}
