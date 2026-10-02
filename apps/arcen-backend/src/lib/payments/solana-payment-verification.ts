// ============================================================
//  ArcenPay Backend — Solana Payment Verification
//
//  Verifies a Solana USDC payment for hosted checkout:
//    1. JSON-RPC `getParsedTransaction` — confirm the tx landed
//       without a runtime error (Solana's analogue of an EVM receipt).
//    2. Inspect the token-balance deltas (`preTokenBalances` /
//       `postTokenBalances`) to confirm the recipient's associated
//       token account credited exactly the expected amount.
//
//  Balance-delta verification (rather than instruction-shape
//  matching) is deliberate: it covers BOTH a direct SPL
//  `transfer`/`transferChecked` AND a program-driven transfer
//  (our Anchor `execute`/`settle` pulling from a subscriber).
//  Stellar's verifier only matched classic `payment` ops and
//  therefore missed SAC `invokeHostFunction` transfers — this
//  module must not repeat that gap.
// ============================================================

import { Connection, PublicKey } from "@solana/web3.js";
import { getSolanaRpcUrl, isSolanaChain } from "@arcenpay/internal-core";

const SOLANA_TX_SIGNATURE_REGEX = /^[1-9A-HJ-NP-Za-km-z]{86,90}$/;

export interface VerifySolanaPaymentInput {
  chainId: number;
  /** Base58 transaction signature. */
  txHash: string;
  /** SPL mint address of the accepted token (e.g. USDC). */
  acceptedToken: string;
  /** Expected payment amount in micros (6 decimals). */
  expectedAmountAtomic: bigint;
  recipientWallet: string;
  senderWallet?: string | null;
}

export type VerifySolanaPaymentResult =
  | {
      ok: true;
      txHash: string;
      senderWallet: string;
      recipientWallet: string;
      amountAtomic: bigint;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

/**
 * Normalizes a Solana transaction signature (base58, no prefix).
 * Returns null when the value is not a plausible signature.
 */
export function normalizeSolanaTxHash(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!SOLANA_TX_SIGNATURE_REGEX.test(trimmed)) return null;
  return trimmed;
}

/** Builds a Connection for the chain's Solana JSON-RPC endpoint. */
export function getSolanaConnection(chainId: number): Connection {
  if (!isSolanaChain(chainId)) {
    throw new Error(`[getSolanaConnection] chainId ${chainId} is not a Solana chain.`);
  }
  const rpcUrl = getSolanaRpcUrl(chainId);
  if (!rpcUrl) {
    throw new Error(
      `[getSolanaConnection] No Solana RPC URL configured for chainId ${chainId}. ` +
        `Set ARCENPAY_SOLANA_RPC_URL_${chainId} or SOLANA_RPC_URL_${chainId}.`,
    );
  }
  return new Connection(rpcUrl, "confirmed");
}

function isValidPublicKey(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/** Minimal shape of a `preTokenBalances`/`postTokenBalances` entry. */
export interface TokenBalanceEntry {
  accountIndex: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string };
}

/**
 * Net token delta credited to `recipientWallet` for `mint`, summed across
 * every token account the recipient owns that appears in the transaction.
 *
 * Balance-delta accounting (rather than instruction-shape matching) is what
 * lets this cover both a direct SPL transfer and a program-driven transfer
 * (our Anchor `execute`/`settle` pulling from a subscriber).
 *
 * Pure and unit-tested (see test/lib/payments/solana-payment-verification.test.ts).
 */
export function computeRecipientTokenDelta(
  pre: readonly TokenBalanceEntry[],
  post: readonly TokenBalanceEntry[],
  params: { recipientWallet: string; mint: string },
): bigint {
  let delta = 0n;
  const keys = new Set<number>([
    ...pre.map((b) => b.accountIndex),
    ...post.map((b) => b.accountIndex),
  ]);

  for (const index of keys) {
    const before = pre.find((b) => b.accountIndex === index);
    const after = post.find((b) => b.accountIndex === index);
    const owner = after?.owner ?? before?.owner;
    const mint = after?.mint ?? before?.mint;
    if (owner !== params.recipientWallet) continue;
    if (mint !== params.mint) continue;

    const beforeAmount = BigInt(before?.uiTokenAmount?.amount ?? "0");
    const afterAmount = BigInt(after?.uiTokenAmount?.amount ?? "0");
    delta += afterAmount - beforeAmount;
  }

  return delta;
}

/**
 * Verifies a Solana SPL-token payment by checking the recipient token
 * account's balance delta for the expected mint.
 */
export async function verifySolanaPayment(
  params: VerifySolanaPaymentInput,
): Promise<VerifySolanaPaymentResult> {
  if (!isSolanaChain(params.chainId)) {
    return {
      ok: false,
      status: 409,
      error: "Chain is not a Solana chain.",
    };
  }
  const signature = normalizeSolanaTxHash(params.txHash);
  if (!signature) {
    return { ok: false, status: 409, error: "Solana transaction signature is malformed." };
  }
  if (!isValidPublicKey(params.acceptedToken)) {
    return { ok: false, status: 409, error: "Accepted token mint is not configured correctly." };
  }
  if (!isValidPublicKey(params.recipientWallet)) {
    return { ok: false, status: 409, error: "Recipient wallet is not configured correctly." };
  }
  if (params.senderWallet && !isValidPublicKey(params.senderWallet)) {
    return { ok: false, status: 409, error: "Sender wallet is not configured correctly." };
  }

  let connection: Connection;
  try {
    connection = getSolanaConnection(params.chainId);
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const parsed = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!parsed) {
      return {
        ok: false,
        status: 425,
        error: "Payment transaction is not yet confirmed.",
      };
    }

    if (parsed.meta?.err) {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction did not complete successfully.",
      };
    }

    const pre = parsed.meta?.preTokenBalances ?? [];
    const post = parsed.meta?.postTokenBalances ?? [];

    // Sum the recipient's balance delta for the accepted mint.
    const delta = computeRecipientTokenDelta(pre, post, {
      recipientWallet: params.recipientWallet,
      mint: params.acceptedToken,
    });

    if (delta <= 0n) {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction did not credit the recipient wallet.",
      };
    }

    if (delta !== params.expectedAmountAtomic) {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction amount does not match the approved total.",
      };
    }

    // Resolve the sender (fee payer / first signer) for audit purposes.
    const accountKeys = parsed.transaction.message.accountKeys;
    const signer =
      accountKeys.find((key) => key.signer)?.pubkey?.toString() ??
      accountKeys[0]?.pubkey?.toString() ??
      "";

    if (params.senderWallet && signer && signer !== params.senderWallet) {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction was sent from the wrong wallet.",
      };
    }

    return {
      ok: true,
      txHash: signature,
      senderWallet: signer,
      recipientWallet: params.recipientWallet,
      amountAtomic: delta,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isPending = /not found|could not find|confirmed/i.test(message);
    return {
      ok: false,
      status: isPending ? 425 : 502,
      error: message,
    };
  }
}
