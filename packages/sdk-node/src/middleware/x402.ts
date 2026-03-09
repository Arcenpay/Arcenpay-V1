// ============================================================
//  @meap/node — x402 Middleware
//  Express middleware for x402 payment-gated API endpoints
//  Implements real EIP-712 signature validation per PRD §7.1
// ============================================================

import type { Request, Response, NextFunction } from "express";
import type {
  X402Response,
  X402RejectionReason,
  X402VerifiedPaymentContext,
} from "@meap/core";
import type { NonceStore } from "../services/nonce-store";
import {
  X402_VERSION,
  X402_SCHEME,
  SessionVaultABI,
  getChainEnvironment,
} from "@meap/core";
import {
  createPublicClient,
  http,
  recoverTypedDataAddress,
  isAddress,
  parseUnits,
} from "viem";
import { sepolia, baseSepolia, base } from "viem/chains";

type X402SettlePaymentInput = {
  signer: `0x${string}`;
  amount: bigint;
  sessionId: string;
  planId: string;
  paymentHeader: string;
  payload: Record<string, unknown>;
  request: Request;
};

type X402SettlePaymentResult = {
  settledAmount: bigint | string | number;
  settlementTxHash?: string | null;
};

export interface X402MiddlewareOptions {
  /** Plan ID for pricing reference */
  planId: string;
  /** Price per API call in USDC (human-readable, e.g., "0.001") */
  ratePerCall: string;
  /** Network identifier (e.g., "base-mainnet") */
  network?: string;
  /** Chain ID for contract reads */
  chainId?: number;
  /** RPC URL for on-chain validation */
  rpcUrl?: string;
  /** Payment facilitator contract address */
  payTo?: string;
  /** Optional settlement hook. Called after payment verification succeeds. */
  settlePayment?: (
    input: X402SettlePaymentInput,
  ) => Promise<X402SettlePaymentResult>;
  /**
   * If true, allow requests when balance check RPC/contract read fails.
   * Default false for production-safe fail-closed behavior.
   */
  failOpenOnBalanceCheck?: boolean;
  /**
   * Maximum age of payment timestamp in milliseconds.
   * Payments older than this window are rejected.
   * Default: 300_000 (5 minutes).
   */
  maxPaymentAgeMs?: number;
  /**
   * TTL for nonce deduplication entries in milliseconds.
   * Set to at least 2x maxPaymentAgeMs.
   * Default: 600_000 (10 minutes).
   */
  nonceTtlMs?: number;
  /**
   * Pluggable nonce store for durable anti-replay protection.
   * Defaults to InMemoryNonceStore if not provided.
   * Use RedisNonceStore for multi-instance production deployments.
   */
  nonceStore?: NonceStore;
}

// EIP-712 domain and types for x402 Payment signature
const PAYMENT_DOMAIN = {
  name: "MEAP x402 Payment",
  version: "1",
} as const;

const PAYMENT_TYPES = {
  Payment: [
    { name: "from", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "resource", type: "string" },
    { name: "sessionId", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "timestamp", type: "uint256" },
  ],
} as const;

const CHAIN_MAP: Record<number, any> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
};

function coerceBigInt(
  value: bigint | string | number,
  fallback: bigint,
): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0) return fallback;
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string" && value.trim()) return BigInt(value.trim());
    return fallback;
  } catch {
    return fallback;
  }
}

function normalizeSessionId(value: unknown): string {
  if (typeof value !== "string") return "default";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "default";
}

function normalizeAmount(value: unknown, fallback: bigint): bigint {
  return coerceBigInt(value as bigint | string | number, fallback);
}

function normalizeNonce(value: unknown): bigint {
  return coerceBigInt(value as bigint | string | number, 0n);
}

function normalizeTimestamp(value: unknown): bigint {
  return coerceBigInt(value as bigint | string | number, BigInt(Date.now()));
}

/**
 * Accept both unix seconds and unix milliseconds.
 * Historical SDK clients sent seconds; newer flows send milliseconds.
 */
export function normalizePaymentTimestampMs(timestamp: bigint): bigint {
  if (timestamp < 1_000_000_000_000n) {
    return timestamp * 1000n;
  }
  return timestamp;
}

export function normalizeResourceUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function buildRequestResource(req: Request): string {
  return `${req.protocol}://${req.get("host")}${req.originalUrl}`;
}

function sendRejection(
  res: Response,
  reason: X402RejectionReason,
  message: string,
  details?: Record<string, unknown>,
) {
  res.setHeader("x-meap-rejection-reason", reason);
  res.status(402).json({
    ok: false,
    rejectionReason: reason,
    message,
    ...(details ? { details } : {}),
  });
}

/**
 * x402 Express Middleware — Production-grade payment validation
 *
 * Validation algorithm (PRD §7.1.1):
 * 1. Parse X-PAYMENT header (base64 JSON)
 * 2. Verify EIP-712 typed data signature → recover signer
 * 3. Verify signer matches payment.from
 * 4. Check SessionVault.getAgentBalance(signer) >= maxAmountRequired
 * 5. Return 402 on failure, attach req.meapPayment on success
 */
export function x402Middleware(options: X402MiddlewareOptions) {
  const {
    planId,
    ratePerCall,
    network = "base-sepolia",
    chainId = 11155111,
    rpcUrl,
    payTo,
    settlePayment,
    failOpenOnBalanceCheck = false,
    maxPaymentAgeMs = 300_000, // 5 minutes
    nonceTtlMs = 600_000, // 10 minutes
    nonceStore: externalNonceStore,
  } = options;

  // ── Nonce deduplication store ──────────────────────────────
  // Uses pluggable NonceStore for durable anti-replay protection.
  // Falls back to InMemoryNonceStore for single-instance / dev use only.
  let nonceStore: NonceStore;
  if (externalNonceStore) {
    nonceStore = externalNonceStore;
  } else {
    // Warn in production: InMemoryNonceStore does not survive restarts and
    // is not safe for multi-instance deployments.  Provide a RedisNonceStore
    // via the `nonceStore` option to suppress this warning.
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[x402] WARNING: Using InMemoryNonceStore in production. " +
          "This does not survive process restarts and is unsafe for multi-instance deployments. " +
          "Pass a RedisNonceStore (or compatible NonceStore) via the `nonceStore` option.",
      );
    }
    // Lazy import to avoid circular deps when NonceStore is unused
    const { InMemoryNonceStore } = require("../services/nonce-store");
    nonceStore = new InMemoryNonceStore();
  }

  const rateAtomicUnits = parseUnits(ratePerCall, 6);
  const chainEnv = getChainEnvironment(chainId);
  const contracts = chainEnv.contracts;
  const payToAddress =
    payTo ||
    contracts.feeCollector ||
    "0x0000000000000000000000000000000000000000";

  // Create viem public client for on-chain reads
  const chain = CHAIN_MAP[chainId] || sepolia;
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl || chainEnv.services.rpcUrl || chain.rpcUrls.default.http[0]),
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentHeader = req.headers["x-payment"] as string | undefined;

    if (!paymentHeader) {
      // No payment — return 402 with x402 payload
      const x402Response: X402Response & {
        ok: false;
        rejectionReason: X402RejectionReason;
      } = {
        ok: false,
        version: X402_VERSION,
        accepts: [
          {
            scheme: X402_SCHEME,
            network,
            maxAmountRequired: rateAtomicUnits.toString(),
            resource: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
            description: `Premium API access — Plan: ${planId}`,
            mimeType: "application/json",
            payTo: payToAddress,
          },
        ],
        error: "Payment required for this resource",
        rejectionReason: "MISSING_PAYMENT_HEADER",
      };

      res.status(402).json(x402Response);
      return;
    }

    try {
      // Step 1: Decode X-PAYMENT header
      let paymentData: any;
      try {
        const normalizedHeader = paymentHeader.trim();
        if (!/^[A-Za-z0-9+/=]+$/.test(normalizedHeader)) {
          sendRejection(
            res,
            "INVALID_PAYMENT_HEADER_ENCODING",
            "X-PAYMENT header must be valid base64-encoded JSON",
          );
          return;
        }

        const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
        paymentData = JSON.parse(decoded);
      } catch {
        sendRejection(
          res,
          "INVALID_PAYMENT_HEADER_FORMAT",
          "X-PAYMENT header must decode to a valid JSON object",
        );
        return;
      }

      const { signature, payload: payloadRaw } = paymentData;
      if (
        typeof signature !== "string" ||
        !signature.startsWith("0x") ||
        !payloadRaw
      ) {
        sendRejection(
          res,
          "MALFORMED_PAYMENT_PAYLOAD",
          "Payment must include valid signature and payload fields",
        );
        return;
      }

      // Parse the payload
      let payload: Record<string, unknown>;
      try {
        const parsedPayload =
          typeof payloadRaw === "string" ? JSON.parse(payloadRaw) : payloadRaw;
        if (
          !parsedPayload ||
          typeof parsedPayload !== "object" ||
          Array.isArray(parsedPayload)
        ) {
          throw new Error("payload must be an object");
        }
        payload = parsedPayload as Record<string, unknown>;
      } catch {
        sendRejection(
          res,
          "MALFORMED_PAYMENT_PAYLOAD",
          "Payment payload must be a valid JSON object",
        );
        return;
      }

      const signerClaimed =
        typeof payload.from === "string" ? payload.from : "";
      if (!isAddress(signerClaimed)) {
        sendRejection(
          res,
          "MALFORMED_PAYMENT_PAYLOAD",
          'Payment payload is missing a valid "from" address',
        );
        return;
      }

      const requestedAmount = normalizeAmount(payload.amount, rateAtomicUnits);
      const sessionId = normalizeSessionId(payload.sessionId);
      const expectedResource = normalizeResourceUrl(buildRequestResource(req));
      const paymentResourceRaw =
        typeof payload.resource === "string" ? payload.resource : "";
      const paymentResource = normalizeResourceUrl(paymentResourceRaw);

      if (
        !expectedResource ||
        !paymentResource ||
        paymentResource !== expectedResource
      ) {
        sendRejection(
          res,
          "RESOURCE_MISMATCH",
          "Payment resource does not match the requested endpoint",
          {
            paymentResource: paymentResourceRaw || null,
            expectedResource: expectedResource || null,
          },
        );
        return;
      }

      if (requestedAmount < rateAtomicUnits) {
        sendRejection(
          res,
          "PAYMENT_AMOUNT_TOO_LOW",
          "Payment amount is below the required endpoint rate",
          {
            providedAmount: requestedAmount.toString(),
            requiredAmount: rateAtomicUnits.toString(),
          },
        );
        return;
      }

      // Step 2: Verify EIP-712 signature (recover signer)
      let recoveredSigner: string;
      try {
        recoveredSigner = await recoverTypedDataAddress({
          domain: { ...PAYMENT_DOMAIN, chainId: BigInt(chainId) },
          types: PAYMENT_TYPES,
          primaryType: "Payment",
          message: {
            from: signerClaimed as `0x${string}`,
            amount: requestedAmount,
            resource: String(payload.resource || ""),
            sessionId,
            nonce: normalizeNonce(payload.nonce),
            timestamp: normalizeTimestamp(payload.timestamp),
          },
          signature: signature as `0x${string}`,
        });
      } catch {
        sendRejection(
          res,
          "INVALID_SIGNATURE",
          "Unable to validate the payment signature",
        );
        return;
      }

      // Step 3: Verify signer matches claimed address
      if (recoveredSigner.toLowerCase() !== signerClaimed.toLowerCase()) {
        sendRejection(
          res,
          "SIGNER_MISMATCH",
          "Recovered signer does not match the payment sender",
        );
        return;
      }

      const verifiedSigner = recoveredSigner as `0x${string}`;

      // Step 3b: Timestamp window check — reject stale payments
      const rawPaymentTimestamp = normalizeTimestamp(payload.timestamp);
      const paymentTimestamp = normalizePaymentTimestampMs(rawPaymentTimestamp);
      const paymentAgeMs = Date.now() - Number(paymentTimestamp);
      if (paymentAgeMs > maxPaymentAgeMs || paymentAgeMs < -60_000) {
        sendRejection(
          res,
          "PAYMENT_EXPIRED" as X402RejectionReason,
          `Payment timestamp is outside the acceptable window (${Math.round(maxPaymentAgeMs / 1000)}s)`,
          {
            rawPaymentTimestamp: rawPaymentTimestamp.toString(),
            paymentTimestamp: paymentTimestamp.toString(),
            serverTime: Date.now().toString(),
          },
        );
        return;
      }

      // Step 3c: Nonce deduplication — reject replay attacks
      const nonce = normalizeNonce(payload.nonce);
      const nonceKey = `${verifiedSigner.toLowerCase()}:${nonce.toString()}`;
      const isFresh = await nonceStore.markUsed(nonceKey, nonceTtlMs);
      if (!isFresh) {
        sendRejection(
          res,
          "NONCE_ALREADY_USED" as X402RejectionReason,
          "This payment nonce has already been used. Use a fresh nonce for each request.",
        );
        return;
      }

      // Step 4: Check session vault balance
      if (verifiedSigner && contracts.sessionVault) {
        try {
          const balance = (await publicClient.readContract({
            address: contracts.sessionVault as `0x${string}`,
            abi: SessionVaultABI,
            functionName: "getAgentBalance",
            args: [verifiedSigner as `0x${string}`],
          })) as bigint;

          if (balance < requestedAmount) {
            sendRejection(
              res,
              "INSUFFICIENT_SESSION_BALANCE",
              "Session balance is below the required amount",
              {
                balance: balance.toString(),
                required: requestedAmount.toString(),
              },
            );
            return;
          }
        } catch (err) {
          if (failOpenOnBalanceCheck) {
            console.warn(
              "[x402] Session vault balance check failed (fail-open enabled):",
              err,
            );
          } else {
            sendRejection(
              res,
              "BALANCE_CHECK_FAILED",
              "Unable to verify session balance on-chain",
            );
            return;
          }
        }
      }

      // Step 5: Optional settlement hook for immediate charge submission
      let settledAmount = requestedAmount;
      let settlementTxHash: string | null = null;

      if (settlePayment) {
        try {
          const settlement = await settlePayment({
            signer: verifiedSigner,
            amount: requestedAmount,
            sessionId,
            planId,
            paymentHeader,
            payload,
            request: req,
          });
          settledAmount = coerceBigInt(
            settlement.settledAmount,
            requestedAmount,
          );
          settlementTxHash = settlement.settlementTxHash || null;
        } catch (err: any) {
          sendRejection(
            res,
            "SETTLEMENT_FAILED",
            err?.message ||
            "Payment verification succeeded but settlement failed",
          );
          return;
        }
      }

      // Step 6: Payment valid — attach typed context and continue
      const verifiedContext: X402VerifiedPaymentContext = {
        verified: true,
        signer: verifiedSigner,
        planId,
        ratePerCall,
        amount: requestedAmount.toString(),
        settledAmount: settledAmount.toString(),
        settlementTxHash,
        sessionId,
        paymentHeader,
        timestamp: Date.now(),
        rejectionReason: null,
      };
      (
        req as Request & { meapPayment?: X402VerifiedPaymentContext }
      ).meapPayment = verifiedContext;

      next();
    } catch (error: any) {
      console.error("[x402] Payment processing error:", error);
      sendRejection(
        res,
        "PAYMENT_PROCESSING_FAILED",
        error.message || "Payment processing failed",
      );
    }
  };
}
