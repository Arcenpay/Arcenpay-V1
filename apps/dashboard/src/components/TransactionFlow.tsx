"use client";

import { parseContractError, getExplorerUrl } from "@/lib/contracts";

type TransactionStatus =
  | "idle"
  | "simulating"
  | "pending"
  | "confirming"
  | "success"
  | "error";

interface TransactionFlowProps {
  status: TransactionStatus;
  txHash?: string;
  error?: unknown;
  chainId?: number;
  onReset?: () => void;
  successMessage?: string;
}

export function TransactionFlow({
  status,
  txHash,
  error,
  chainId = 11155111,
  onReset,
  successMessage = "Transaction confirmed!",
}: TransactionFlowProps) {
  if (status === "idle") return null;

  return (
    <div className="transaction-flow">
      {status === "simulating" && (
        <div className="tx-step">
          <span className="tx-spinner" />
          Simulating transaction...
        </div>
      )}
      {status === "pending" && (
        <div className="tx-step">
          <span className="tx-spinner" />
          Confirm in your wallet...
        </div>
      )}
      {status === "confirming" && (
        <div className="tx-step">
          <span className="tx-spinner" />
          <span>Waiting for confirmation...</span>
          {txHash && (
            <a
              href={getExplorerUrl(txHash, chainId, "tx")}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginLeft: 8 }}
            >
              View on Explorer
            </a>
          )}
        </div>
      )}
      {status === "success" && (
        <div className="tx-step tx-success">
          <span>{successMessage}</span>
          {txHash && (
            <a
              href={getExplorerUrl(txHash, chainId, "tx")}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginLeft: 8 }}
            >
              View Transaction
            </a>
          )}
        </div>
      )}
      {status === "error" && error ? (
        <div className="tx-step tx-error">
          <span>{parseContractError(error)}</span>
          {onReset && (
            <button className="btn" onClick={onReset} style={{ marginLeft: 8 }}>
              Try Again
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
