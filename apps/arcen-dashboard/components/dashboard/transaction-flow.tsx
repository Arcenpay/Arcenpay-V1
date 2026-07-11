"use client";

import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type TransactionStep =
  | "idle"
  | "simulating"
  | "pending"
  | "inflight"
  | "success"
  | "error";

interface TransactionFlowProps {
  step: TransactionStep;
  txHash?: string;
  blockExplorerUrl?: string;
  gasEstimate?: string;
  errorMessage?: string;
  confirmations?: number;
  onDismiss?: () => void;
  className?: string;
}

const CONTRACT_ERRORS: Record<string, string> = {
  NotSubscribed: "Your wallet does not have an active subscription.",
  PlanNotFound: "This plan no longer exists or has been deactivated.",
  InsufficientBalance:
    "Your session vault balance is too low. Please deposit more USDC.",
  ModuleAlreadyInstalled: "Autopay is already set up for this provider.",
  NullifierUsed: "This usage proof has already been submitted.",
};

function parseErrorMessage(raw: string): string {
  for (const [key, friendly] of Object.entries(CONTRACT_ERRORS)) {
    if (raw.includes(key)) return friendly;
  }
  if (raw.includes("user rejected")) return "Transaction was rejected in wallet.";
  if (raw.includes("insufficient funds")) return "Insufficient ETH for gas fees.";
  return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
}

export function TransactionFlow({
  step,
  txHash,
  blockExplorerUrl,
  gasEstimate,
  errorMessage,
  confirmations = 0,
  onDismiss,
  className,
}: TransactionFlowProps) {
  if (step === "idle") return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-secondary/40 p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300",
        step === "error" && "border-border bg-secondary",
        step === "success" && "border-border bg-success/5",
        className
      )}
    >
      {/* Step: Simulating */}
      {step === "simulating" && (
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Simulating transaction…
            </p>
            <p className="text-xs text-muted-foreground">
              Pre-validating contract call and estimating gas
            </p>
          </div>
        </div>
      )}

      {/* Step: Pending (awaiting wallet confirm) */}
      {step === "pending" && (
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Confirm in wallet
            </p>
            {gasEstimate && (
              <p className="text-xs text-muted-foreground">
                Estimated gas: {gasEstimate}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step: In-flight (submitted to chain) */}
      {step === "inflight" && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Transaction submitted
              </p>
              <p className="text-xs text-muted-foreground">
                Waiting for {confirmations} confirmation{confirmations !== 1 ? "s" : ""}…
              </p>
            </div>
          </div>
          {txHash && blockExplorerUrl && (
            <a
              href={`${blockExplorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-accent hover:underline shrink-0"
            >
              View <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Step: Success */}
      {step === "success" && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Transaction confirmed
              </p>
              {txHash && (
                <p className="text-xs text-muted-foreground font-mono">
                  {txHash.slice(0, 10)}…{txHash.slice(-8)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {txHash && blockExplorerUrl && (
              <a
                href={`${blockExplorerUrl}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-accent hover:underline shrink-0"
              >
                Explorer <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {onDismiss && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Step: Error */}
      {step === "error" && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">
                Transaction failed
              </p>
              {errorMessage && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {parseErrorMessage(errorMessage)}
                </p>
              )}
            </div>
          </div>
          {onDismiss && (
            <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
