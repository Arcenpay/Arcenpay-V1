"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export type SafeOwnerActionPayload = {
  description?: string;
  target?: string;
  value?: string;
  data?: string;
  functionSignature?: string;
  args?: string[];
  safeTransaction?: {
    to: string;
    value: string;
    data: string;
    operation: number;
  };
};

type SafeTransactionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: SafeOwnerActionPayload;
  planFactoryOwner?: string | null;
  relayerAddress?: string | null;
  connectedWallet?: string | null;
  onExecuted?: () => void;
};

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function normalizeHexValue(raw: string | undefined): `0x${string}` {
  if (!raw) return "0x0";
  try {
    return `0x${BigInt(raw).toString(16)}` as `0x${string}`;
  } catch {
    return "0x0";
  }
}

export function SafeTransactionDialog({
  open,
  onOpenChange,
  payload,
  planFactoryOwner,
  relayerAddress,
  connectedWallet,
  onExecuted,
}: SafeTransactionDialogProps) {
  const [executing, setExecuting] = useState(false);

  const isConnectedOwner = useMemo(() => {
    if (!planFactoryOwner || !connectedWallet) return false;
    return planFactoryOwner.toLowerCase() === connectedWallet.toLowerCase();
  }, [planFactoryOwner, connectedWallet]);

  const payloadJson = useMemo(
    () =>
      JSON.stringify(
        {
          planFactoryOwner: planFactoryOwner ?? null,
          relayerAddress: relayerAddress ?? null,
          ownerActionRequired: payload,
        },
        null,
        2,
      ),
    [payload, planFactoryOwner, relayerAddress],
  );

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(payloadJson);
      toast.success("Owner action payload copied");
    } catch {
      toast.error("Could not copy payload");
    }
  }

  async function executeWithConnectedWallet() {
    if (!payload.target || !payload.data) {
      toast.error("Missing target/data in owner action payload");
      return;
    }
    if (!connectedWallet) {
      toast.error("Connect the owner wallet first");
      return;
    }
    if (!isConnectedOwner) {
      toast.error(
        planFactoryOwner
          ? `Switch to owner wallet ${short(planFactoryOwner)} to execute this transaction`
          : "Connected wallet is not the owner wallet",
      );
      return;
    }
    const provider = (
      window as Window & {
        ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      }
    ).ethereum;
    if (!provider) {
      toast.error("No injected wallet found");
      return;
    }

    setExecuting(true);
    try {
      const txHash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: connectedWallet,
            to: payload.target,
            value: normalizeHexValue(payload.value),
            data: payload.data,
          },
        ],
      });
      const hash = String(txHash ?? "");
      toast.success(`Owner tx submitted · ${hash.slice(0, 10)}…`);
      onExecuted?.();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit transaction";
      if (msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("denied")) {
        toast.error("Transaction rejected");
      } else {
        toast.error(msg);
      }
    } finally {
      setExecuting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Owner Action Required</DialogTitle>
          <DialogDescription>
            The provider wallet must be registered on PlanFactory before plan registration can continue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-secondary/40 p-3 space-y-1">
            <p>
              <span className="font-medium">Owner:</span>{" "}
              {planFactoryOwner ?? "Unknown"}
            </p>
            <p>
              <span className="font-medium">Provider to register:</span>{" "}
              {relayerAddress ?? "Unknown"}
            </p>
            <p>
              <span className="font-medium">Target:</span>{" "}
              {payload.target ?? "Unknown"}
            </p>
            <p>
              <span className="font-medium">Function:</span>{" "}
              {payload.functionSignature ?? "registerProvider(address)"}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Safe / multisig payload
            </p>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-black/90 p-3 text-[11px] leading-5 text-green-200">
              {payloadJson}
            </pre>
          </div>

          {planFactoryOwner && connectedWallet && !isConnectedOwner && (
            <p className="text-xs text-amber-600">
              Connected wallet {short(connectedWallet)} is not the owner wallet {short(planFactoryOwner)}.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={copyJson}>
            Copy Payload
          </Button>
          <Button
            type="button"
            onClick={executeWithConnectedWallet}
            disabled={!isConnectedOwner || !payload.target || !payload.data || executing}
          >
            {executing ? "Submitting…" : "Execute With Connected Wallet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
