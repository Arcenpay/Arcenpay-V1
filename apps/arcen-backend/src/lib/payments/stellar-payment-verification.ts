// ============================================================
//  ArcenPay Backend — Stellar Payment Verification
//
//  Verifies a Stellar USDC payment for hosted checkout:
//    1. Soroban RPC `getTransaction` — confirm the tx reached
//       SUCCESS (Stellar's equivalent of an EVM receipt).
//    2. Horizon `GET /transactions/{hash}/operations` — locate
//       the payment operation and match asset, recipient, amount.
//
//  USDC on Stellar is a credit_alphanum4 asset issued by a
//  G… account (SAC). Payment links store `acceptedToken` as the
//  G… issuer (or a C… SAC contract id); both forms are resolved
//  to the issuer for the Horizon operation match.
// ============================================================

import {
  getStellarNetworkPassphrase,
  getStellarSorobanRpcUrl,
  isStellarChain,
} from "@arcenpay/internal-core";

export interface VerifyStellarPaymentInput {
  chainId: number;
  txHash: string;
  /** G… SAC issuer or C… SAC contract id of the USDC asset. */
  acceptedToken: string;
  /** Expected payment amount in micros (6 decimals). */
  expectedAmountMicros: bigint;
  recipientWallet: string;
  senderWallet?: string | null;
}

export type VerifyStellarPaymentResult =
  | {
      ok: true;
      txHash: string;
      senderWallet: string;
      recipientWallet: string;
      amountMicros: bigint;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

// Known issuer → asset-code map (Circle USDC on testnet + mainnet).
// Mirrors the map in routes/v1/subscriptions-activate.ts.
const KNOWN_ASSET_CODES: Record<string, string> = {
  GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5: "USDC",
  GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5REQK4DVZWA: "USDC",
};

const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
const STELLAR_CONTRACT_REGEX = /^C[A-Z0-9]{55}$/;
const STELLAR_TX_HASH_REGEX = /^[a-fA-F0-9]{64}$/;

/**
 * Normalizes a Stellar Soroban transaction hash.
 * Accepts a bare 64-hex hash or an `0x`-prefixed variant and strips the prefix.
 */
export function normalizeStellarTxHash(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const clean = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!STELLAR_TX_HASH_REGEX.test(clean)) return null;
  return clean;
}

function horizonUrlForChain(chainId: number): string {
  const passphrase = getStellarNetworkPassphrase(chainId);
  return passphrase.includes("Test")
    ? "https://horizon-testnet.stellar.org"
    : "https://horizon.stellar.org";
}

/**
 * Converts a Horizon amount string to atomic micros (6 decimals).
 * Horizon reports non-native assets with 7 decimal places; we round to
 * micros (the platform's internal unit) rather than rejecting.
 */
function decimalToMicros(value: string): bigint | null {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  // Round the 7th decimal (Horizon's native precision) into the 6th.
  let frac = fraction.slice(0, 6);
  const roundUp = fraction.length > 6 && Number(fraction[6]) >= 5;
  if (roundUp) {
    const incremented = BigInt(frac || "0") + 1n;
    if (incremented >= 1_000_000n) {
      // Carry into the whole part.
      return (BigInt(whole) + 1n) * 1_000_000n;
    }
    frac = incremented.toString().padStart(6, "0");
  }
  return BigInt(whole) * 1_000_000n + BigInt(frac || "0");
}

/**
 * Resolves a Stellar SAC contract id from an issuer G… address.
 * Returns null when the issuer is unknown and Horizon cannot confirm the asset.
 */
async function resolveSacContractId(
  chainId: number,
  issuer: string,
): Promise<string | null> {
  let assetCode: string | undefined = KNOWN_ASSET_CODES[issuer];
  if (!assetCode) {
    try {
      const res = await fetch(
        `${horizonUrlForChain(chainId)}/assets?asset_issuer=${issuer}&limit=1`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          _embedded?: { records?: Array<{ asset_code?: string }> };
        };
        assetCode = data._embedded?.records?.[0]?.asset_code ?? undefined;
      }
    } catch {
      return null;
    }
  }
  if (!assetCode) return null;
  const { Asset } = await import("@stellar/stellar-sdk");
  const asset = new Asset(assetCode, issuer);
  return (asset as unknown as { contractId(passphrase: string): string }).contractId(
    getStellarNetworkPassphrase(chainId),
  );
}

/**
 * Resolves the accepted token to `{ issuer, assetCode }`.
 * Accepts either a G… issuer or a C… SAC contract id.
 */
async function resolveStellarAsset(
  chainId: number,
  acceptedToken: string,
): Promise<{ issuer: string; assetCode: string } | null> {
  const trimmed = acceptedToken.trim();
  if (STELLAR_ACCOUNT_REGEX.test(trimmed)) {
    const assetCode = KNOWN_ASSET_CODES[trimmed];
    if (!assetCode) return null;
    return { issuer: trimmed, assetCode };
  }
  if (STELLAR_CONTRACT_REGEX.test(trimmed)) {
    // SAC contract id → issuer via Horizon (invert resolveSacContractId).
    try {
      const res = await fetch(
        `${horizonUrlForChain(chainId)}/assets?limit=200`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        _embedded?: { records?: Array<{ asset_code?: string; asset_issuer?: string }> };
      };
      const passphrase = getStellarNetworkPassphrase(chainId);
      for (const record of data._embedded?.records ?? []) {
        if (!record.asset_code || !record.asset_issuer) continue;
        const { Asset } = await import("@stellar/stellar-sdk");
        const asset = new Asset(record.asset_code, record.asset_issuer);
        const contractId = (
          asset as unknown as { contractId(passphrase: string): string }
        ).contractId(passphrase);
        if (contractId === trimmed) {
          return { issuer: record.asset_issuer, assetCode: record.asset_code };
        }
      }
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

async function verifySorobanTransaction(
  chainId: number,
  txHash: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  try {
    const rpcUrl = getStellarSorobanRpcUrl(chainId);
    if (!rpcUrl) {
      return {
        ok: false,
        status: 502,
        error: `No Soroban RPC URL configured for chain ${chainId}.`,
      };
    }
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: { hash: txHash },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        error: `Soroban RPC returned ${response.status}.`,
      };
    }
    const json = (await response.json()) as {
      result?: { status?: string };
      error?: { message?: string };
    };
    if (json.error?.message) {
      return { ok: false, status: 502, error: json.error.message };
    }
    const status = json.result?.status ?? "UNKNOWN";
    if (status === "SUCCESS") return { ok: true };
    if (status === "NOT_FOUND") {
      return {
        ok: false,
        status: 425,
        error: "Transaction not found on-chain yet.",
      };
    }
    return { ok: false, status: 409, error: `Transaction status: ${status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 502, error: `Stellar RPC error: ${msg}` };
  }
}

/**
 * Verifies a Stellar USDC payment for a checkout session.
 * Mirrors the result shape of `verifyDirectErc20Transfer` so the
 * checkout confirm path can dispatch on chain family uniformly.
 */
export async function verifyStellarPayment(
  params: VerifyStellarPaymentInput,
): Promise<VerifyStellarPaymentResult> {
  if (!isStellarChain(params.chainId)) {
    return {
      ok: false,
      status: 409,
      error: `Chain ${params.chainId} is not a Stellar chain.`,
    };
  }

  const txHash = normalizeStellarTxHash(params.txHash);
  if (!txHash) {
    return {
      ok: false,
      status: 409,
      error: "Payment transaction hash is not a valid Stellar hash.",
    };
  }

  if (!STELLAR_ACCOUNT_REGEX.test(params.recipientWallet)) {
    return {
      ok: false,
      status: 409,
      error: "Recipient wallet is not configured correctly.",
    };
  }
  if (
    params.senderWallet &&
    !STELLAR_ACCOUNT_REGEX.test(params.senderWallet)
  ) {
    return {
      ok: false,
      status: 409,
      error: "Sender wallet is not configured correctly.",
    };
  }

  const asset = await resolveStellarAsset(params.chainId, params.acceptedToken);
  if (!asset || asset.assetCode !== "USDC") {
    return {
      ok: false,
      status: 409,
      error: "Accepted token is not a supported Stellar USDC asset.",
    };
  }

  const soroban = await verifySorobanTransaction(params.chainId, txHash);
  if (!soroban.ok) return soroban;

  // Locate the payment operation on Horizon.
  try {
    const operationsRes = await fetch(
      `${horizonUrlForChain(params.chainId)}/transactions/${txHash}/operations`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!operationsRes.ok) {
      return {
        ok: false,
        status: 425,
        error: "Payment transaction has no visible operations yet.",
      };
    }
    const data = (await operationsRes.json()) as {
      _embedded?: {
        records?: Array<{
          type?: string;
          asset_type?: string;
          asset_code?: string;
          asset_issuer?: string;
          from?: string;
          to?: string;
          amount?: string;
        }>;
      };
    };

    const payment = data._embedded?.records?.find(
      (op) =>
        op.type === "payment" &&
        op.asset_type === "credit_alphanum4" &&
        op.asset_code === asset.assetCode &&
        op.asset_issuer === asset.issuer &&
        op.to === params.recipientWallet,
    );

    if (!payment) {
      return {
        ok: false,
        status: 409,
        error:
          "Payment transaction did not include a matching USDC payment to the recipient wallet.",
      };
    }

    if (params.senderWallet && payment.from !== params.senderWallet) {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction was sent from the wrong wallet.",
      };
    }

    const amountMicros = decimalToMicros(payment.amount ?? "0");
    if (amountMicros === null || amountMicros !== params.expectedAmountMicros) {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction amount does not match the approved total.",
      };
    }

    return {
      ok: true,
      txHash,
      senderWallet: payment.from ?? "",
      recipientWallet: payment.to ?? "",
      amountMicros,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 502, error: `Horizon error: ${msg}` };
  }
}

export { resolveSacContractId, resolveStellarAsset, horizonUrlForChain };
