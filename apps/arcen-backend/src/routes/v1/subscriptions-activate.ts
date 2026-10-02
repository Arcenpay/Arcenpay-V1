/**
 * POST /api/v1/subscriptions/activate
 *
 * Prepare or confirm the first authorized on-chain subscription activation.
 *
 * Auth:
 *   - Bearer sk_/pk_/rk_ (recommended for provider backends)
 *   - Dashboard session cookie
 *
 * Body:
 * {
 *   planId: string | number,      // on-chain PlanFactory plan ID
 *   paymentAccount: string,       // subscriber EOA or smart account
 *   company: { id?, wallet?, email?, name?, traits? },
 *   subscriberEmail?: string
 * }
 */

import type { Context } from "hono";
import {
  createPublicClient,
  encodeFunctionData,
  decodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseEventLogs,
} from "viem";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  ERC7579AutopayModuleABI,
  getChain,
  getChainFamily,
  getContractAddresses,
  getSolanaRpcUrl,
  getStellarSorobanRpcUrl,
  getStellarNetworkPassphrase,
  PlanFactoryABI,
  SubscriptionRegistryABI,
  YEARLY_INTERVAL,
} from "@arcenpay/internal-core";
import { contract as stellarContract } from "@stellar/stellar-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  encodeSubscribe,
  findConfigPda,
  findPlanPda,
  findSubscriptionPda,
  findSubscriptionByWalletPda,
  findSubscriptionDelegatePda,
  findAssociatedTokenAddress,
  decodePlanRecord,
  decodeConfigRecord,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
} from "../../lib/payments/solana-instruction.js";
import { Prisma } from "../../generated/client/client.js";
import { db } from "../../db.js";
import { createResilientPublicClient, getRpcUrl } from "../../config.js";
import { DEFAULT_CHAIN_ID } from "../../lib/platform/default-chain.js";
import { getLatestSubscriptionChangeRequest } from "../../lib/billing/subscription-change-requests.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import {
  requireAnyAuth,
  isAnyAuthError,
} from "../../lib/auth/require-any-auth.js";
import { isApiKeyToken } from "../../lib/auth/api-key-auth.js";
import {
  resolveCompany,
  type CompanyKeys,
} from "../../lib/entitlements/flag-engine.js";
import { resolveEmbedAccessToken } from "../../lib/entitlements/embed-access-token.js";
import { getSession } from "../../lib/auth/auth.server.js";
import { resolveDashboardSessionIdentityDefaults } from "../../lib/auth/dashboard-session-identity.js";
import { resolveBillingRecipientEmail } from "../../lib/billing/billing-events.js";
import {
  enqueueSubscriptionActivationRecovery,
  finalizeSubscriptionActivation,
  processBillingRecoveryTask,
} from "../../lib/billing/billing-recovery.js";
import { upsertSubscriptionLedgerState } from "../../lib/billing/billing-ledger.js";
import { normalizeWallet } from "../../lib/billing/utils.js";
import { resolveSacContractId } from "../../lib/payments/stellar-payment-verification.js";
import { corsHeaders } from "../../middleware/cors.js";

const evmAddressSchema = z
  .string()
  .refine((value) => isAddress(value), "Must be a valid EVM address");

const walletAddressSchema = z
  .string()
  .min(1)
  .max(128);

/**
 * Tx-hash validation must accept every chain family: EVM (`0x`+64 hex, or bare
 * 64 hex), Stellar (64 hex) and Solana (base58 signature). A hex-only pattern
 * silently rejected Solana activations with a 400 before the Solana branch ran.
 */
const TX_HASH_REGEX =
  /^(0x[0-9a-fA-F]{64}|[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{43,90})$/;

const companySchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    wallet: walletAddressSchema.optional(),
    email: z.string().email().optional(),
    name: z.string().trim().min(1).optional(),
    traits: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (value) => Boolean(value.id || value.wallet || value.email),
    "company.id, company.wallet, or company.email is required",
  );

const bodySchema = z.object({
  planId: z.union([z.string().trim().min(1), z.number().int().positive()]),
  paymentAccount: walletAddressSchema,
  subscriberEmail: z.string().email().optional(),
  activationTxHash: z
    .string()
    .regex(TX_HASH_REGEX)
    .optional(),
  txHash: z
    .string()
    .regex(TX_HASH_REGEX)
    .optional(),
  company: companySchema,
});

const ANNUAL_BILLING_INTERVAL_SECONDS = YEARLY_INTERVAL;

const registryOwnerOfAbi = [
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const erc20ReadAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function clearScheduledCancellationTransition(
  companyId: string,
): Promise<boolean> {
  const company = await db.arcenCompany.findUnique({
    where: { id: companyId },
    select: { teamId: true },
  });
  if (!company?.teamId) {
    return false;
  }

  const latestChangeRequest = await getLatestSubscriptionChangeRequest({
    teamId: company.teamId,
    companyId,
  });
  if (
    latestChangeRequest?.id &&
    latestChangeRequest.changeType === "cancellation"
  ) {
    await db.subscriptionChangeRequest.update({
      where: { id: latestChangeRequest.id },
      data: {
        stage: "REVERTED",
        appliedAt: new Date(),
        pendingVerification: false,
        failureReason: null,
      },
    });
    return true;
  }
  return false;
}

function formatTokenAmount(
  amount: bigint,
  decimals: number,
  symbol: string,
): string {
  const formatted = Number(formatUnits(amount, decimals));
  const safe =
    Number.isFinite(formatted) && formatted < 1_000_000_000
      ? formatted.toFixed(decimals === 6 ? 2 : Math.min(decimals, 4))
      : formatUnits(amount, decimals);
  return `${safe} ${symbol}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientActivationLookupError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  return (
    (message.includes("transaction") && message.includes("not found")) ||
    (message.includes("receipt") && message.includes("not found")) ||
    message.includes("could not be found") ||
    message.includes("unknown transaction") ||
    message.includes("missing transaction") ||
    message.includes("missing receipt")
  );
}

async function readSubmittedActivationTransaction(params: {
  publicClient: any;
  txHash: `0x${string}`;
}): Promise<{
  transaction: Awaited<ReturnType<typeof params.publicClient.getTransaction>>;
  receipt: Awaited<
    ReturnType<typeof params.publicClient.getTransactionReceipt>
  >;
}> {
  const attempts = 8;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const [transaction, receipt] = await Promise.all([
        params.publicClient.getTransaction({ hash: params.txHash }),
        params.publicClient.getTransactionReceipt({ hash: params.txHash }),
      ]);

      return { transaction, receipt };
    } catch (error) {
      if (
        !isTransientActivationLookupError(error) ||
        attempt === attempts - 1
      ) {
        throw error;
      }

      await sleep(1_500);
    }
  }

  throw new Error(
    "Activation transaction is still propagating. Please wait a moment and try again.",
  );
}

type AutopayActivationSnapshot = {
  isInitialized: boolean;
  config: {
    merchant?: string;
    maxAmount?: bigint;
    interval?: number | bigint;
    startTime?: bigint;
    planId?: bigint;
  } | null;
};

async function readAutopayActivationSnapshot(params: {
  publicClient: any;
  autopayAddress: string;
  paymentAccount: string;
}): Promise<AutopayActivationSnapshot> {
  const isInitialized = (await params.publicClient.readContract({
    address: params.autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "isInitialized",
    args: [params.paymentAccount],
  })) as boolean;

  if (!isInitialized) {
    return { isInitialized: false, config: null };
  }

  const config = (await params.publicClient.readContract({
    address: params.autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "getConfig",
    args: [params.paymentAccount],
  })) as {
    merchant?: string;
    maxAmount?: bigint;
    interval?: number | bigint;
    startTime?: bigint;
    planId?: bigint;
  };

  return { isInitialized: true, config };
}

async function waitForAutopayActivationSnapshot(params: {
  publicClient: any;
  autopayAddress: string;
  paymentAccount: string;
  expectedPlanId: bigint;
  expectedMerchant: string;
}): Promise<AutopayActivationSnapshot> {
  const attempts = 6;
  let latest: AutopayActivationSnapshot = {
    isInitialized: false,
    config: null,
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await readAutopayActivationSnapshot(params);

    const configPlanId = BigInt(latest.config?.planId ?? 0n);
    const configMerchant = String(latest.config?.merchant ?? "").toLowerCase();
    if (
      latest.isInitialized &&
      configPlanId === params.expectedPlanId &&
      configMerchant === params.expectedMerchant
    ) {
      return latest;
    }

    if (attempt < attempts - 1) {
      await sleep(750);
    }
  }

  return latest;
}

function requiredConfirmations(): number {
  const raw = process.env.ONCHAIN_MIN_CONFIRMATIONS?.trim();
  if (!raw) return 2;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
}

function normalizeActivationError(message: string): {
  status: number;
  error: string;
} {
  const lower = message.toLowerCase();

  if (
    lower.includes("transfer amount exceeds balance") ||
    lower.includes("erc20insufficientbalance")
  ) {
    return {
      status: 409,
      error:
        "The payment account does not have enough token balance for the first subscription charge.",
    };
  }

  if (
    lower.includes("insufficient allowance") ||
    lower.includes("erc20insufficientallowance")
  ) {
    return {
      status: 409,
      error:
        "The payment account has not approved enough token allowance for autopay to collect the first charge.",
    };
  }

  if (
    lower.includes("request limit reached") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("429") ||
    lower.includes("fetch failed") ||
    lower.includes("-32011") ||
    lower.includes("econnrefused") ||
    lower.includes("rpc request failed") ||
    lower.includes("http request failed") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("network error") ||
    lower.includes("etimedout") ||
    lower.includes("socket hang up") ||
    lower.includes("connect econnreset")
  ) {
    return {
      status: 429,
      error:
        "RPC network error or rate limit reached. Please wait a moment and click Activate subscription again.",
    };
  }

  if (
    (lower.includes("transaction") || lower.includes("receipt")) &&
    lower.includes("not found")
  ) {
    return {
      status: 425,
      error:
        "Activation transaction is still propagating. Please wait a moment and try again.",
    };
  }

  if (lower.includes("confirmation")) {
    return {
      status: 425,
      error: message,
    };
  }

  if (
    lower.includes("execution reverted") ||
    lower.includes("revert") ||
    lower.includes("contract call failed") ||
    lower.includes("unknown error") ||
    lower.includes("internal error") ||
    lower.includes("-32603") ||
    lower.includes("-32000")
  ) {
    return {
      status: 409,
      error:
        "The blockchain transaction was reverted. Please ensure your wallet has sufficient token balance and try again.",
    };
  }

  return {
    status: 500,
    error: message,
  };
}

// ── Stellar transaction verification ─────────────────────────────────────────

async function verifyStellarTransaction(params: {
  chainId: number;
  txHash: string;
}): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const rpcUrl = getStellarSorobanRpcUrl(params.chainId);
    const cleanHash = params.txHash.startsWith("0x")
      ? params.txHash.slice(2)
      : params.txHash;

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: { hash: cleanHash },
      }),
    });

    const json = (await response.json()) as {
      result?: { status?: string; txHash?: string };
      error?: { message?: string };
    };

    if (json.error?.message) {
      return { ok: false, error: json.error.message };
    }

    const status = json.result?.status ?? "UNKNOWN";
    if (status === "SUCCESS") {
      return { ok: true, status };
    }
    if (status === "NOT_FOUND") {
      return { ok: false, status, error: "Transaction not found on-chain yet." };
    }
    return { ok: false, status, error: `Transaction status: ${status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Stellar RPC error: ${msg}` };
  }
}

async function checkStellarAutopayInitialized(
  chainId: number,
  autopayContractId: string,
  account: string,
): Promise<boolean> {
  try {
    const rpcUrl = getStellarSorobanRpcUrl(chainId);
    const networkPassphrase = getStellarNetworkPassphrase(chainId);
    const client = (await stellarContract.Client.from({
      contractId: autopayContractId,
      networkPassphrase,
      rpcUrl,
    })) as any;
    const { result } = await client.is_initialized({ account });
    return Boolean(result);
  } catch {
    return false;
  }
}

async function checkStellarSacBalance(
  chainId: number,
  assetIssuer: string,
  account: string,
): Promise<{ balanceMicros: bigint; hasTrustline: boolean }> {
  try {
    const networkPassphrase = getStellarNetworkPassphrase(chainId);
    const horizonUrl =
      networkPassphrase.includes("Test")
        ? "https://horizon-testnet.stellar.org"
        : "https://horizon.stellar.org";
    const res = await fetch(`${horizonUrl}/accounts/${account}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { balanceMicros: 0n, hasTrustline: false };
    const data = (await res.json()) as {
      balances?: Array<{
        balance: string;
        asset_issuer?: string;
        asset_code?: string;
      }>;
    };
    const match = data.balances?.find(
      (b) => b.asset_issuer === assetIssuer,
    );
    if (!match) return { balanceMicros: 0n, hasTrustline: false };
    // Horizon balance strings have 7 decimal places for non-native assets;
    // convert to micros (6 decimals) by parsing and rounding.
    const amount = parseFloat(match.balance);
    return {
      balanceMicros: BigInt(Math.round(amount * 1_000_000)),
      hasTrustline: true,
    };
  } catch {
    return { balanceMicros: 0n, hasTrustline: false };
  }
}

async function assertReceiptFinalized(params: {
  publicClient: any;
  receipt: { blockNumber?: bigint | null };
  label: string;
}): Promise<void> {
  const blockNumber = params.receipt.blockNumber;
  if (!blockNumber) {
    throw new Error(`${params.label} receipt is missing a block number.`);
  }

  const latestBlock = await params.publicClient.getBlockNumber();
  const confirmations =
    latestBlock >= blockNumber ? latestBlock - blockNumber + 1n : 0n;
  const required = BigInt(requiredConfirmations());

  if (confirmations < required) {
    throw new Error(
      `${params.label} has ${confirmations.toString()} confirmation(s); ${required.toString()} required before activating the subscription.`,
    );
  }
}

async function upsertCompanyForActivation(
  teamId: string,
  environmentId: string | null,
  keys: CompanyKeys & {
    name?: string;
    traits?: Record<string, unknown>;
  },
  paymentAccount?: string | null,
): Promise<{ id: string; activePlanId: string | null; created: boolean }> {
  // First: try direct ID lookup (SDK sends ArcenCompany.id as company.id,
  // but flag-engine.resolveCompany maps keys.id to externalId — mismatch)
  if (keys.id) {
    const directMatch = await db.arcenCompany.findFirst({
      where: { id: keys.id, teamId, ...(environmentId ? { environmentId } : {}) },
      select: { id: true, activePlanId: true, walletAddress: true, email: true },
    });
    if (directMatch) {
      const updates: Record<string, unknown> = {};
      if (keys.name?.trim()) updates.name = keys.name.trim();
      if (keys.email?.trim()) updates.email = keys.email.trim().toLowerCase();
      if (keys.wallet?.trim()) {
        updates.walletAddress = normalizeWallet(keys.wallet) ?? keys.wallet.trim();
      }
      if (Object.keys(updates).length > 0) {
        try {
          await db.arcenCompany.update({ where: { id: directMatch.id }, data: updates });
        } catch { /* ignore unique constraint races */ }
      }
      return { id: directMatch.id, activePlanId: directMatch.activePlanId, created: false };
    }
  }

  const existing =
    (await resolveCompany(teamId, {
      ...keys,
      environmentId,
    })) ??
    (paymentAccount
      ? await resolveCompany(teamId, {
          wallet: paymentAccount,
          environmentId,
        })
      : null);
  if (existing) {
    const updates: Record<string, unknown> = {};
    if (keys.name?.trim()) updates.name = keys.name.trim();
    if (keys.email?.trim()) updates.email = keys.email.trim();
    if (keys.wallet?.trim()) {
      updates.walletAddress = normalizeWallet(keys.wallet) ?? keys.wallet.trim();
    }
    if (Object.keys(updates).length > 0) {
      try {
        await db.arcenCompany.update({
          where: { id: existing.id },
          data: updates,
        });
      } catch (err: unknown) {
        const isUniqueConstraintError =
          err instanceof Error &&
          "code" in err &&
          (err as { code: string }).code === "P2002";
        if (isUniqueConstraintError && keys.wallet?.trim()) {
          const normalizedWallet = normalizeWallet(keys.wallet) ?? keys.wallet.trim();
          const existingByWallet = await db.arcenCompany.findFirst({
            where: {
              teamId,
              environmentId: environmentId ?? null,
              walletAddress: normalizedWallet,
            },
            select: { id: true, activePlanId: true },
          });
          if (existingByWallet) {
            return {
              id: existingByWallet.id,
              activePlanId: existingByWallet.activePlanId,
              created: false,
            };
          }
        }
        throw err;
      }
    }
    return {
      id: existing.id,
      activePlanId: existing.activePlanId,
      created: false,
    };
  }

  const created = await db.arcenCompany.create({
    data: {
      teamId,
      environmentId,
      name: keys.name ?? keys.email ?? keys.id ?? "Unknown",
      email: keys.email ?? null,
      walletAddress: keys.wallet
        ? normalizeWallet(keys.wallet) ?? keys.wallet.trim()
        : null,
      externalId: keys.id ?? null,
      traits: (keys.traits ?? {}) as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return { id: created.id, activePlanId: null, created: true };
}

async function readActiveWalletSubscriptionTokenId(params: {
  publicClient: any;
  subscriptionRegistryAddress: `0x${string}`;
  wallet: string;
}): Promise<bigint> {
  const hasActiveSubscription = (await params.publicClient.readContract({
    address: params.subscriptionRegistryAddress,
    abi: SubscriptionRegistryABI,
    functionName: "hasActiveSubscription",
    args: [params.wallet],
  })) as boolean;

  if (!hasActiveSubscription) return 0n;

  const tokenId = (await params.publicClient.readContract({
    address: params.subscriptionRegistryAddress,
    abi: SubscriptionRegistryABI,
    functionName: "getWalletSubscription",
    args: [params.wallet],
  })) as bigint;

  if (tokenId <= 0n) return 0n;

  const owner = (await params.publicClient.readContract({
    address: params.subscriptionRegistryAddress,
    abi: registryOwnerOfAbi,
    functionName: "ownerOf",
    args: [tokenId],
  })) as `0x${string}`;

  return owner.toLowerCase() === params.wallet.toLowerCase() ? tokenId : 0n;
}

/**
 * Deterministic u64 token id for a Solana subscription, derived from the
 * subscriber wallet + on-chain plan id. Deterministic so repeated activation
 * attempts resolve the same subscription PDA (idempotency).
 */
function deriveSolanaTokenId(wallet: string, planId: string): bigint {
  const digest = createHash("sha256")
    .update(`arcenpay:solana:subscription:${wallet}:${planId}`)
    .digest();
  const id = digest.readBigUInt64BE(0);
  return id === 0n ? 1n : id;
}

/**
 * Verifies a submitted Solana `subscribe` transaction: confirmed + successful,
 * invoked the ArcenPay program, called Subscribe, and emitted
 * `SubscriptionMinted`.
 */
async function verifySolanaActivation(input: {
  connection: Connection;
  programId: string;
  txHash: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  try {
    // The wallet confirms the transaction before calling us, but OUR RPC node
    // may not have it yet (propagation lag between different nodes). Wait for it
    // briefly rather than failing a customer who has already been charged — the
    // old single-shot read surfaced a scary "not confirmed" error while the
    // payment had in fact gone through, and the plan was then applied seconds
    // later by the event pipeline, out of sync with what the user was told.
    const maxWaitMs = Number(process.env.SOLANA_TX_WAIT_MS || 15_000);
    const pollMs = 1_500;
    const deadline = Date.now() + maxWaitMs;
    const fetchTx = async () =>
      input.connection
        .getParsedTransaction(input.txHash, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        })
        .catch(() => null);
    let tx = await fetchTx();
    while (!tx && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      tx = await fetchTx();
    }
    if (!tx) {
      return {
        ok: false,
        status: 425,
        error: "Solana transaction is still propagating to our RPC node.",
      };
    }
    if (tx.meta?.err) {
      return { ok: false, status: 409, error: "Solana transaction failed on-chain." };
    }

    const accountKeys = tx.transaction.message.accountKeys ?? [];
    const invoked = accountKeys.some((k: any) => {
      const pk =
        typeof k?.pubkey?.toBase58 === "function"
          ? k.pubkey.toBase58()
          : String(k?.pubkey ?? k);
      return pk === input.programId;
    });
    if (!invoked) {
      return {
        ok: false,
        status: 409,
        error: "Transaction did not invoke the ArcenPay Solana program.",
      };
    }

    const logs = tx.meta?.logMessages ?? [];
    if (!logs.some((l) => l.includes("Instruction: Subscribe"))) {
      return { ok: false, status: 409, error: "Transaction did not call subscribe." };
    }

    const mintDiscriminator = createHash("sha256")
      .update("event:SubscriptionMinted")
      .digest()
      .subarray(0, 8)
      .toString("hex");
    const prefix = "Program data: ";
    const minted = logs.some((line) => {
      if (!line.startsWith(prefix)) return false;
      try {
        const payload = Buffer.from(line.slice(prefix.length), "base64");
        return payload.subarray(0, 8).toString("hex") === mintDiscriminator;
      } catch {
        return false;
      }
    });
    if (!minted) {
      return {
        ok: false,
        status: 409,
        error: "Transaction did not emit SubscriptionMinted.",
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `Solana verification error: ${(err as Error).message}`,
    };
  }
}

export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

export async function POST(c: Context) {
  const origin = c.req.header("origin");
  const authHeader = c.req.header("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  let teamId: string;
  let embedTokenContext: Awaited<
    ReturnType<typeof resolveEmbedAccessToken>
  > | null = null;
  let sessionDefaults: Awaited<
    ReturnType<typeof resolveDashboardSessionIdentityDefaults>
  > | null = null;
  if (bearerToken && !isApiKeyToken(bearerToken)) {
    embedTokenContext = await resolveEmbedAccessToken(bearerToken);
    if (!embedTokenContext) {
      return c.json(
        { error: "Invalid or expired token" },
        401,
        corsHeaders(origin),
      );
    }
    if (
      embedTokenContext.platformBilling &&
      embedTokenContext.teamRole !== "OWNER" &&
      embedTokenContext.teamRole !== "ADMIN" &&
      embedTokenContext.teamRole !== "FINANCE"
    ) {
      return c.json(
        {
          error:
            "Only workspace billing administrators can change the platform subscription",
        },
        403,
        corsHeaders(origin),
      );
    }
    teamId = embedTokenContext.teamId;
  } else {
    const auth = await requireAnyAuth(c);
    if (isAnyAuthError(auth)) {
      return c.json(
        { ok: false, error: auth.error },
        auth.status as any as any,
        corsHeaders(origin),
      );
    }
    teamId = auth.teamId;
    if (auth.source === "session") {
      const session = await getSession();
      if (session) {
        sessionDefaults = await resolveDashboardSessionIdentityDefaults(
          teamId,
          (session as any).clerkUserId,
          auth.activeEnvironmentId ?? null,
        );
      }
    }
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400, corsHeaders(origin));
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
      corsHeaders(origin),
    );
  }

  // `parsed.data.planId` is the CATALOG plan id (a cuid like "cmupa8pck…").
  // The on-chain plan id is a separate numeric field on the plan record.
  // Converting the cuid here threw `Cannot convert … to a BigInt` and broke
  // every Solana activation before its branch could run.
  const numericPlanIdArg = /^\d+$/.test(String(parsed.data.planId).trim())
    ? BigInt(String(parsed.data.planId).trim())
    : null;
  const onChainPlanId = numericPlanIdArg ?? 0n;
  const rawPaymentAccount = parsed.data.paymentAccount.trim();
  // EVM lowercases; Stellar (G…/C…) and Solana (base58) are case-sensitive.
  const paymentAccount = (normalizeWallet(rawPaymentAccount) ??
    rawPaymentAccount) as `0x${string}`;
  const activationCompanyInput = {
    ...parsed.data.company,
    ...(sessionDefaults && {
      name:
        parsed.data.company.name ?? sessionDefaults.companyName ?? undefined,
      email:
        parsed.data.company.email ?? sessionDefaults.companyEmail ?? undefined,
      wallet:
        parsed.data.company.wallet ??
        sessionDefaults.walletAddress ??
        undefined,
    }),
  };

  // ── Wrap all post-validation logic in one top-level try/catch ───────────────
  // This ensures any RPC error (rate limit, timeout, CORS) thrown by any
  // readContract / getTransaction call below is caught and normalized
  // into a proper HTTP response instead of an unhandled 500.
  try {
    const catalogPlan = await db.catalogPlan.findFirst({
      where: {
        teamId,
        active: true,
        status: "PUBLISHED",
        // The client sends the CATALOG plan id (a cuid). Accept a numeric
        // on-chain id as well, for callers that pass that instead.
        ...(numericPlanIdArg
          ? { onChainPlanId: numericPlanIdArg.toString() }
          : { id: String(parsed.data.planId).trim() }),
      },
      select: {
        id: true,
        name: true,
        price: true,
        billingInterval: true,
        acceptedToken: true,
        chainId: true,
        environmentId: true,
        onChainPlanId: true,
      },
    });

    if (!catalogPlan) {
      return c.json(
        {
          error:
            "Published team plan not found for the supplied on-chain planId.",
        },
        404,
        corsHeaders(origin),
      );
    }

    const company = await upsertCompanyForActivation(
      teamId,
      catalogPlan.environmentId ?? null,
      activationCompanyInput,
      paymentAccount,
    );

    const previousCompany = await db.arcenCompany.findUnique({
      where: { id: company.id },
      select: { activePlanId: true },
    });

    // Use the chain the plan was registered on. Fall back to DEFAULT_CHAIN_ID for
    // legacy plans that pre-date the chainId column (they'll have the default 84532).
    const chainId = catalogPlan.chainId ?? DEFAULT_CHAIN_ID;
    const chainFamily = getChainFamily(chainId);
    const isStellar = chainFamily === "stellar";

    // ── Solana activation path ───────────────────────────────────────────────
    // Mirrors the Stellar 3-step flow: return a prepared `subscribe` instruction
    // (program id + account metas + base64 data) for the wallet to sign, then
    // verify the submitted transaction and finalize billing.
    if (chainFamily === "solana") {
      const contracts = getContractAddresses(chainId);
      if (!contracts.subscriptionRegistry || !contracts.planFactory) {
        return c.json(
          {
            error:
              `Solana billing is not enabled for chain ${chainId}: the ArcenPay Anchor program is not ` +
              `configured. Deploy the program and set ARCENPAY_CONTRACT_${chainId}_* before activating.`,
          },
          503,
          corsHeaders(origin),
        );
      }

      const rpcUrl = getSolanaRpcUrl(chainId);
      if (!rpcUrl) {
        return c.json(
          { error: `No Solana RPC URL configured for chain ${chainId}.` },
          503,
          corsHeaders(origin),
        );
      }

      const programIdStr = contracts.subscriptionRegistry;
      const connection = new Connection(rpcUrl, "confirmed");
      const priceMicros = Math.round(Number(catalogPlan.price ?? "0") * 1_000_000);
      const solanaBillingPeriod: "monthly" | "annual" =
        (catalogPlan as any).billingInterval >= YEARLY_INTERVAL ? "annual" : "monthly";

      // The on-chain plan id lives on the catalog record — the request normally
      // carries the catalog cuid, not the numeric on-chain id.
      const solanaOnChainPlanId =
        numericPlanIdArg ??
        (catalogPlan.onChainPlanId ? BigInt(catalogPlan.onChainPlanId) : null);
      if (!solanaOnChainPlanId) {
        return c.json(
          {
            error:
              "This plan is not registered on-chain yet. Register it on-chain before subscribing.",
          },
          409,
          corsHeaders(origin),
        );
      }

      const [planPda] = findPlanPda(programIdStr, solanaOnChainPlanId);
      const [configPda] = findConfigPda(programIdStr);

      let plan: ReturnType<typeof decodePlanRecord> = null;
      let configRec: ReturnType<typeof decodeConfigRecord> = null;
      try {
        const [planInfo, configInfo] = await Promise.all([
          connection.getAccountInfo(planPda),
          connection.getAccountInfo(configPda),
        ]);
        plan = planInfo ? decodePlanRecord(planInfo.data as Buffer) : null;
        configRec = configInfo ? decodeConfigRecord(configInfo.data as Buffer) : null;
      } catch (err) {
        return c.json(
          { error: `Failed to read Solana plan/config: ${(err as Error).message}` },
          502,
          corsHeaders(origin),
        );
      }

      if (!plan) {
        return c.json(
          { error: "On-chain Solana plan not found for the supplied planId." },
          404,
          corsHeaders(origin),
        );
      }
      if (!plan.active) {
        return c.json({ error: "The on-chain Solana plan is inactive." }, 409, corsHeaders(origin));
      }
      if (!configRec) {
        return c.json(
          { error: "ArcenPay Solana program is not initialized on-chain." },
          503,
          corsHeaders(origin),
        );
      }

      const tokenId = deriveSolanaTokenId(paymentAccount, solanaOnChainPlanId.toString());
      const [subscriptionPda] = findSubscriptionPda(programIdStr, tokenId);
      const [byWalletPda] = findSubscriptionByWalletPda(programIdStr, paymentAccount);
      const mint = plan.acceptedToken;
      // Shared (owner, mint) autopay authority — `subscribe` approves this PDA
      // as the SPL token delegate, so it must be in the account list between
      // `subscription_by_wallet` and `token_mint` (program declaration order).
      const [delegatePda] = findSubscriptionDelegatePda(
        programIdStr,
        paymentAccount,
        mint,
      );
      const subscriberAta = findAssociatedTokenAddress(paymentAccount, mint);
      const providerAta = findAssociatedTokenAddress(plan.provider, mint);
      const treasuryAta = findAssociatedTokenAddress(configRec.treasury, mint);

      let submittedSolanaTx = (
        parsed.data.activationTxHash ?? parsed.data.txHash
      )?.trim();

      // Idempotency (D3): `subscribe` hard-`init`s the subscription PDA, so if a
      // previous attempt already minted it but finalization failed, asking the
      // wallet to sign again is impossible (simulation: "already in use") — and
      // would be a second charge. Recover the minting signature and finalize
      // from it instead, so a retry repairs rather than dead-ends.
      if (!submittedSolanaTx) {
        const existingSubscription = await connection
          .getAccountInfo(subscriptionPda, "confirmed")
          .catch(() => null);
        if (existingSubscription) {
          const signatures = await connection
            .getSignaturesForAddress(subscriptionPda, { limit: 10 })
            .catch(() => []);
          const minted = [...signatures].reverse().find((s) => !s.err);
          if (minted) submittedSolanaTx = minted.signature;
        }
      }

      if (!submittedSolanaTx) {
        return c.json(
          {
            data: {
              activationRequired: true,
              paymentAccount,
              chargeAmountAtomic: String(priceMicros),
              chargeAmountDisplay: `${catalogPlan.price ?? "0"} USDC`,
              preparedTransaction: {
                family: "solana",
                rpcUrl,
                programId: programIdStr,
                instruction: {
                  keys: [
                    { pubkey: configPda.toBase58(), isSigner: false, isWritable: false },
                    { pubkey: planPda.toBase58(), isSigner: false, isWritable: false },
                    { pubkey: paymentAccount, isSigner: true, isWritable: true },
                    { pubkey: subscriptionPda.toBase58(), isSigner: false, isWritable: true },
                    { pubkey: byWalletPda.toBase58(), isSigner: false, isWritable: true },
                    { pubkey: delegatePda.toBase58(), isSigner: false, isWritable: false },
                    { pubkey: mint, isSigner: false, isWritable: false },
                    { pubkey: subscriberAta.toBase58(), isSigner: false, isWritable: true },
                    { pubkey: providerAta.toBase58(), isSigner: false, isWritable: true },
                    { pubkey: treasuryAta.toBase58(), isSigner: false, isWritable: true },
                    { pubkey: TOKEN_PROGRAM_ID.toBase58(), isSigner: false, isWritable: false },
                    { pubkey: SYSTEM_PROGRAM_ID.toBase58(), isSigner: false, isWritable: false },
                  ],
                  data: encodeSubscribe(tokenId, priceMicros).toString("base64"),
                },
              },
              verification: {
                chainId,
                acceptedToken: mint,
                merchantAddress: plan.provider,
                onChainPlanId: solanaOnChainPlanId.toString(),
                onChainTokenId: tokenId.toString(),
              },
            },
          },
          202,
          corsHeaders(origin),
        );
      }

      const verify = await verifySolanaActivation({
        connection,
        programId: programIdStr,
        txHash: submittedSolanaTx,
      });
      if (!verify.ok) {
        return c.json(
          { error: verify.error },
          verify.status as any,
          corsHeaders(origin),
        );
      }

      const subscriberEmail = await resolveBillingRecipientEmail({
        teamId,
        environmentId: catalogPlan.environmentId ?? null,
        explicitEmail:
          parsed.data.subscriberEmail ?? sessionDefaults?.userEmail ?? null,
        accessTokenUserId: embedTokenContext?.userId ?? null,
        accessTokenCompanyId: embedTokenContext?.companyId ?? null,
        companyId: company.id,
        walletAddress: paymentAccount,
      });

      const solanaFinalizationPayload = {
        companyId: company.id,
        customerUserId: embedTokenContext?.userId ?? sessionDefaults?.userId ?? null,
        environmentId: catalogPlan.environmentId ?? null,
        walletAddress: paymentAccount,
        catalogPlanId: catalogPlan.id,
        catalogPlanName: catalogPlan.name,
        billingPeriod: solanaBillingPeriod,
        customerName:
          typeof activationCompanyInput.name === "string" &&
          activationCompanyInput.name.trim()
            ? activationCompanyInput.name.trim()
            : null,
        onChainPlanId: onChainPlanId.toString(),
        onChainTokenId: tokenId.toString(),
        expiration: String(
          Math.floor(Date.now() / 1000) +
            Number(catalogPlan.billingInterval ?? 2592000),
        ),
        txHash: submittedSolanaTx,
        amount: Number(priceMicros) / 1e6,
        currency: "USDC",
        merchantAddress: plan.provider,
        acceptedToken: mint,
        subscriberEmail,
        occurredAt: new Date().toISOString(),
        previousPlanId: previousCompany?.activePlanId ?? null,
        chainId,
      };

      let recoveryTaskId: string | null = null;
      let recoveryPending = false;
      let invoiceId: string | null = null;
      let paymentId: string | null = null;

      try {
        const finalization = await finalizeSubscriptionActivation({
          teamId,
          payload: solanaFinalizationPayload,
          source: "subscription.activate",
        });
        invoiceId = finalization.invoiceId;
        paymentId = finalization.paymentId;
      } catch (finalizationError) {
        console.error(
          "[subscriptions/activate] Solana finalization failed; queuing recovery task.",
          finalizationError,
        );
        const recoveryTask = await enqueueSubscriptionActivationRecovery({
          teamId,
          ...solanaFinalizationPayload,
          occurredAt: new Date(solanaFinalizationPayload.occurredAt),
        });
        recoveryTaskId = recoveryTask.id;
        const recoveryResult = await processBillingRecoveryTask({
          taskId: recoveryTask.id,
        });
        recoveryPending = !recoveryResult.ok;
      }

      // The on-chain subscription is confirmed at this point. If the billing
      // projection could not be committed, that is a failure — not a "pending"
      // success. Returning 202 here made the client show "finalizing…" forever
      // while the company stayed on Free. Surface it as an error so it is
      // visible and retryable.
      if (recoveryPending) {
        return c.json(
          {
            error:
              "The on-chain subscription was confirmed, but the billing state could not be finalized. No second charge will be made; this is safe to retry.",
            txHash: submittedSolanaTx,
            recoveryTaskId,
          },
          409,
          corsHeaders(origin),
        );
      }

      return c.json(
        {
          data: {
            txHash: submittedSolanaTx,
            companyId: company.id,
            planId: catalogPlan.id,
            paymentAccount,
            onChainTokenId: tokenId.toString(),
            invoiceId,
            paymentId,
            recoveryTaskId,
            recoveryPending,
          },
        },
        200,
        corsHeaders(origin),
      );
    }

    // ── Stellar activation path ──────────────────────────────────────────────
    if (isStellar) {
      const contracts = getContractAddresses(chainId);
      if (!contracts.autopayModule || !contracts.subscriptionRegistry || !contracts.planFactory) {
        return c.json(
          { error: `Stellar contracts are not configured for chain ${chainId}.` },
          503,
          corsHeaders(origin),
        );
      }

      const priceMicros = Math.round(
        Number(catalogPlan.price ?? "0") * 1_000_000,
      );
      const stellarBillingPeriod: "monthly" | "annual" =
        (catalogPlan as any).billingInterval >= YEARLY_INTERVAL
          ? "annual"
          : "monthly";

      const submittedStellarTx = (
        parsed.data.activationTxHash ?? parsed.data.txHash
      )?.trim();

      const autopayInitialized = await checkStellarAutopayInitialized(
        chainId,
        contracts.autopayModule,
        paymentAccount,
      );

      // Resolve the SAC contract ID from the asset issuer (catalogPlan.acceptedToken).
      // The autopay contract needs the C… contract id, not the G… issuer.
      const sacContractId = catalogPlan.acceptedToken
        ? await resolveSacContractId(chainId, catalogPlan.acceptedToken)
        : null;

      // Step 1: Configure autopay if not initialized
      if (!autopayInitialized) {
        if (!submittedStellarTx) {
          return c.json(
            {
              data: {
                activationRequired: true,
                paymentAccount,
                chargeAmountAtomic: priceMicros.toString(),
                chargeAmountDisplay: `${catalogPlan.price ?? "0"} ${catalogPlan.acceptedToken ?? "XLM"}`,
                preparedTransaction: {
                  contractId: contracts.autopayModule,
                  method: "configure",
                  args: {
                    account: paymentAccount,
                    config: {
                      merchant: contracts.planFactory,
                      max_amount: priceMicros.toString(),
                      token: sacContractId ?? catalogPlan.acceptedToken ?? "",
                      interval: Number(catalogPlan.billingInterval ?? 2592000),
                      start_time: 0,
                      plan_id: onChainPlanId.toString(),
                      max_total_amount: "0",
                    },
                  },
                },
                verification: {
                  chainId,
                  acceptedToken: catalogPlan.acceptedToken ?? "",
                  merchantAddress: contracts.planFactory,
                  onChainPlanId: onChainPlanId.toString(),
                },
              },
            },
            202,
            corsHeaders(origin),
          );
        }

        // A txHash was submitted but autopay is still not initialized.
        // Verify the tx, then return an error so the user can retry.
        const verifyResult = await verifyStellarTransaction({
          chainId,
          txHash: submittedStellarTx,
        });
        if (!verifyResult.ok) {
          return c.json(
            { error: verifyResult.error ?? "Stellar transaction verification failed." },
            425,
            corsHeaders(origin),
          );
        }
        return c.json(
          { error: "Autopay configuration is still pending. Please retry in a few moments." },
          409,
          corsHeaders(origin),
        );
      }

      // Step 2: Autopay is initialized → check SAC balance / trustline, then return execute
      if (!submittedStellarTx) {
        const sacCheck = catalogPlan.acceptedToken
          ? await checkStellarSacBalance(chainId, catalogPlan.acceptedToken, paymentAccount)
          : { balanceMicros: 0n, hasTrustline: false };
        if (!sacCheck.hasTrustline) {
          return c.json(
            {
              error: `No trustline found for ${catalogPlan.acceptedToken ?? "the payment token"}. Please add a trustline for this asset in your Stellar wallet before activating.`,
            },
            402,
            corsHeaders(origin),
          );
        }
        if (sacCheck.balanceMicros < BigInt(priceMicros)) {
          return c.json(
            {
              error: `Insufficient USDC balance. Required: ${priceMicros} micros (~${catalogPlan.price ?? "0"} USDC), Available: ${sacCheck.balanceMicros.toString()} micros. Please fund your Stellar wallet with testnet USDC (issuer: ${catalogPlan.acceptedToken ?? ""}) and try again.`,
            },
            402,
            corsHeaders(origin),
          );
        }

        return c.json(
          {
            data: {
              activationRequired: true,
              paymentAccount,
              chargeAmountAtomic: priceMicros.toString(),
              chargeAmountDisplay: `${catalogPlan.price ?? "0"} ${catalogPlan.acceptedToken ?? "XLM"}`,
              preparedTransaction: {
                contractId: contracts.autopayModule,
                method: "execute",
                args: {
                  caller: paymentAccount,
                  account: paymentAccount,
                  amount: priceMicros.toString(),
                },
              },
              verification: {
                chainId,
                acceptedToken: catalogPlan.acceptedToken ?? "",
                merchantAddress: contracts.planFactory,
                onChainPlanId: onChainPlanId.toString(),
              },
            },
          },
          202,
          corsHeaders(origin),
        );
      }

      // Step 3: txHash submitted and autopay is configured → verify and finalize inline
      const verifyResult = await verifyStellarTransaction({
        chainId,
        txHash: submittedStellarTx,
      });

      if (!verifyResult.ok) {
        return c.json(
          { error: verifyResult.error ?? "Stellar transaction verification failed." },
          425,
          corsHeaders(origin),
        );
      }

      const subscriberEmail = await resolveBillingRecipientEmail({
        teamId,
        environmentId: catalogPlan.environmentId ?? null,
        explicitEmail:
          parsed.data.subscriberEmail ??
          sessionDefaults?.userEmail ??
          null,
        accessTokenUserId: embedTokenContext?.userId ?? null,
        accessTokenCompanyId: embedTokenContext?.companyId ?? null,
        companyId: company.id,
        walletAddress: paymentAccount,
      });

      // Build finalization payload inline (same pattern as EVM path)
      const stellarFinalizationPayload = {
        companyId: company.id,
        customerUserId: embedTokenContext?.userId ?? sessionDefaults?.userId ?? null,
        environmentId: catalogPlan.environmentId ?? null,
        walletAddress: paymentAccount,
        catalogPlanId: catalogPlan.id,
        catalogPlanName: catalogPlan.name,
        billingPeriod: stellarBillingPeriod,
        customerName:
          typeof activationCompanyInput.name === "string" &&
          activationCompanyInput.name.trim()
            ? activationCompanyInput.name.trim()
            : null,
        onChainPlanId: onChainPlanId.toString(),
        onChainTokenId: "0",
        expiration: String(Math.floor(Date.now() / 1000) + Number(catalogPlan.billingInterval ?? 2592000)),
        txHash: submittedStellarTx,
        amount: Number(priceMicros) / 1e6,
        currency: "USDC",
        merchantAddress: contracts.planFactory,
        acceptedToken: catalogPlan.acceptedToken ?? null,
        subscriberEmail,
        occurredAt: new Date().toISOString(),
        previousPlanId: previousCompany?.activePlanId ?? null,
        chainId,
      };

      let recoveryTaskId: string | null = null;
      let recoveryPending = false;
      let invoiceId: string | null = null;
      let paymentId: string | null = null;

      try {
        const finalization = await finalizeSubscriptionActivation({
          teamId,
          payload: stellarFinalizationPayload,
          source: "subscription.activate",
        });
        invoiceId = finalization.invoiceId;
        paymentId = finalization.paymentId;
      } catch (finalizationError) {
        console.error(
          "[subscriptions/activate] Stellar immediate billing finalization failed; queuing recovery task.",
          finalizationError,
        );

        const recoveryTask = await enqueueSubscriptionActivationRecovery({
          teamId,
          ...stellarFinalizationPayload,
          occurredAt: new Date(stellarFinalizationPayload.occurredAt),
        });
        recoveryTaskId = recoveryTask.id;

        const recoveryResult = await processBillingRecoveryTask({
          taskId: recoveryTask.id,
        });
        recoveryPending = !recoveryResult.ok;
      }

      return c.json(
        {
          data: {
            txHash: submittedStellarTx,
            companyId: company.id,
            planId: catalogPlan.id,
            paymentAccount,
            invoiceId,
            paymentId,
            recoveryTaskId,
            recoveryPending,
          },
        },
        recoveryPending ? 202 : 200,
        corsHeaders(origin),
      );
    }

    // ── EVM activation path (existing) ─────────────────────────────────────
    const chain = getChain(chainId);
    const rpcUrl = getRpcUrl(chainId);
    const contracts = getContractAddresses(chainId);

    const autopayAddress = contracts.autopayModule as `0x${string}`;
    const subscriptionRegistryAddress =
      contracts.subscriptionRegistry as `0x${string}`;
    const planFactoryAddress = contracts.planFactory as `0x${string}`;

    const zeroAddress = "0x0000000000000000000000000000000000000000";
    if (
      !autopayAddress ||
      !subscriptionRegistryAddress ||
      !planFactoryAddress ||
      autopayAddress === zeroAddress ||
      subscriptionRegistryAddress === zeroAddress ||
      planFactoryAddress === zeroAddress
    ) {
      return c.json(
        {
          error: `Subscription contracts are not configured for chain ${chainId}.`,
        },
        503,
        corsHeaders(origin),
      );
    }

    const publicClient = createResilientPublicClient(chainId);

    const onChainPlan = (await publicClient.readContract({
      address: planFactoryAddress,
      abi: PlanFactoryABI,
      functionName: "getPlan",
      args: [onChainPlanId],
    })) as {
      provider?: string;
      active?: boolean;
      price?: bigint;
      acceptedToken?: string;
    };

    const merchantAddress = String(onChainPlan?.provider ?? "").toLowerCase();
    if (!onChainPlan?.active) {
      return c.json(
        { error: "The requested on-chain plan is inactive." },
        409,
        corsHeaders(origin),
      );
    }

    const autopaySnapshot = await waitForAutopayActivationSnapshot({
      publicClient,
      autopayAddress,
      paymentAccount,
      expectedPlanId: onChainPlanId,
      expectedMerchant: merchantAddress,
    });
    const isInitialized = autopaySnapshot.isInitialized;

    if (!isInitialized) {
      return c.json(
        {
          error:
            "Autopay is not installed for this payment account yet. Complete checkout setup before requesting activation.",
        },
        409,
        corsHeaders(origin),
      );
    }

    const autopayConfig = autopaySnapshot.config;

    const configPlanId = BigInt(autopayConfig?.planId ?? 0n);
    if (configPlanId !== onChainPlanId) {
      return c.json(
        {
          error: `Autopay config mismatch. Payment account is configured for on-chain plan ${configPlanId.toString()}, not ${onChainPlanId.toString()}.`,
        },
        409,
        corsHeaders(origin),
      );
    }

    const configMerchant = String(autopayConfig?.merchant ?? "").toLowerCase();
    if (configMerchant !== merchantAddress) {
      return c.json(
        {
          error:
            `Autopay merchant mismatch. Payment account expects ${configMerchant}, ` +
            `but the on-chain plan provider is ${merchantAddress}.`,
        },
        409,
        corsHeaders(origin),
      );
    }

    const chargeAmount = BigInt(autopayConfig?.maxAmount ?? 0n);
    if (chargeAmount <= 0n) {
      return c.json(
        { error: "Autopay config has no billable amount configured." },
        409,
        corsHeaders(origin),
      );
    }

    const autopayIntervalSeconds = Number(autopayConfig?.interval ?? 0n);
    const resolvedBillingPeriod: "monthly" | "annual" =
      autopayIntervalSeconds >= ANNUAL_BILLING_INTERVAL_SECONDS
        ? "annual"
        : "monthly";

    const acceptedTokenAddress = isAddress(
      String(onChainPlan?.acceptedToken ?? catalogPlan.acceptedToken ?? ""),
    )
      ? (String(
          onChainPlan?.acceptedToken ?? catalogPlan.acceptedToken,
        ).toLowerCase() as `0x${string}`)
      : null;

    if (!acceptedTokenAddress) {
      return c.json(
        { error: "Catalog plan accepted token is not configured correctly." },
        409,
        corsHeaders(origin),
      );
    }

    const submittedActivationTxHash = (
      parsed.data.activationTxHash ?? parsed.data.txHash
    )?.toLowerCase() as `0x${string}` | undefined;

    const existingTokenId = await readActiveWalletSubscriptionTokenId({
      publicClient,
      subscriptionRegistryAddress,
      wallet: paymentAccount,
    });

    if (existingTokenId > 0n) {
      const [existingExpiration, existingPlanFeatures] = await Promise.all([
        publicClient.readContract({
          address: subscriptionRegistryAddress,
          abi: SubscriptionRegistryABI,
          functionName: "expiresAt",
          args: [existingTokenId],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: subscriptionRegistryAddress,
          abi: SubscriptionRegistryABI,
          functionName: "getPlanFeatures",
          args: [existingTokenId],
        }) as Promise<[bigint, string]>,
      ]);

      const existingOnChainPlanId = existingPlanFeatures[0].toString();
      const existingCatalogPlan =
        (await db.catalogPlan.findFirst({
          where: {
            teamId,
            onChainPlanId: existingOnChainPlanId,
          },
          select: { id: true, name: true },
        })) ?? null;

      await upsertSubscriptionLedgerState({
        teamId,
        companyId: company.id,
        walletAddress: paymentAccount,
        chainId,
        status: "ACTIVE",
        catalogPlanId: existingCatalogPlan?.id ?? catalogPlan.id,
        onChainPlanId: existingOnChainPlanId,
        onChainTokenId: existingTokenId.toString(),
        currentPeriodEnd:
          existingExpiration > 0n
            ? new Date(Number(existingExpiration) * 1000)
            : null,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        pastDueAt: null,
        graceEndsAt: null,
        lastEvent: "subscription.reconciled",
        lastEventAt: new Date(),
        metadata: {
          source: "subscription.activate",
          activationMode: "existing_token_reconciliation",
        },
      });

      if (existingOnChainPlanId === onChainPlanId.toString()) {
        let invoiceId: string | null = null;
        let paymentId: string | null = null;
        let recoveryTaskId: string | null = null;
        let recoveryPending = false;

        if (submittedActivationTxHash) {
          const [activationTransaction, activationReceipt, subscriberEmail] =
            await Promise.all([
              publicClient
                .getTransaction({ hash: submittedActivationTxHash })
                .catch(() => null),
              publicClient
                .getTransactionReceipt({ hash: submittedActivationTxHash })
                .catch(() => null),
              resolveBillingRecipientEmail({
                teamId,
                environmentId: catalogPlan.environmentId ?? null,
                explicitEmail:
                  parsed.data.subscriberEmail ??
                  sessionDefaults?.userEmail ??
                  null,
                accessTokenUserId: embedTokenContext?.userId ?? null,
                accessTokenCompanyId: embedTokenContext?.companyId ?? null,
                companyId: company.id,
                walletAddress: paymentAccount,
              }),
            ]);

          let activationTxMatches = false;
          if (
            activationTransaction?.to?.toLowerCase() ===
              autopayAddress.toLowerCase() &&
            activationReceipt?.status === "success"
          ) {
            try {
              const decoded = decodeFunctionData({
                abi: ERC7579AutopayModuleABI,
                data: activationTransaction.input,
              });
              const [decodedAccount, decodedAmount] = decoded.args as [
                `0x${string}`,
                bigint,
              ];
              activationTxMatches =
                decoded.functionName === "execute" &&
                decodedAccount.toLowerCase() === paymentAccount.toLowerCase() &&
                decodedAmount === chargeAmount;
            } catch {
              activationTxMatches = false;
            }
          }

          if (!activationTxMatches) {
            console.warn(
              "[subscriptions/activate] Skipping existing-token invoice finalization because the supplied activation tx could not be verified.",
            );
          } else {
            let occurredAt = new Date();
            if (activationReceipt?.blockNumber != null) {
              const activationBlock = await publicClient
                .getBlock({ blockNumber: activationReceipt.blockNumber })
                .catch(() => null);
              if (activationBlock?.timestamp != null) {
                occurredAt = new Date(Number(activationBlock.timestamp) * 1000);
              }
            }

            const finalizationPayload = {
              companyId: company.id,
              customerUserId:
                embedTokenContext?.userId ?? sessionDefaults?.userId ?? null,
              environmentId: catalogPlan.environmentId ?? null,
              walletAddress: paymentAccount,
              catalogPlanId: existingCatalogPlan?.id ?? catalogPlan.id,
              catalogPlanName: existingCatalogPlan?.name ?? catalogPlan.name,
              billingPeriod: resolvedBillingPeriod,
              customerName:
                typeof activationCompanyInput.name === "string" &&
                activationCompanyInput.name.trim()
                  ? activationCompanyInput.name.trim()
                  : null,
              onChainPlanId: existingOnChainPlanId,
              onChainTokenId: existingTokenId.toString(),
              expiration: existingExpiration.toString(),
              txHash: submittedActivationTxHash,
              amount: Number(chargeAmount) / 1e6,
              currency: "USDC",
              merchantAddress,
              acceptedToken: catalogPlan.acceptedToken ?? null,
              subscriberEmail,
              occurredAt: occurredAt.toISOString(),
              previousPlanId: company.activePlanId ?? null,
              chainId,
            };

            try {
              const finalization = await finalizeSubscriptionActivation({
                teamId,
                payload: finalizationPayload,
                source: "subscription.activate.reconcile",
              });
              invoiceId = finalization.invoiceId;
              paymentId = finalization.paymentId;
            } catch (finalizationError) {
              console.error(
                "[subscriptions/activate] Existing active subscription finalization failed; queuing recovery task.",
                finalizationError,
              );

              const recoveryTask = await enqueueSubscriptionActivationRecovery({
                teamId,
                ...finalizationPayload,
                occurredAt,
              });
              recoveryTaskId = recoveryTask.id;

              const recoveryResult = await processBillingRecoveryTask({
                taskId: recoveryTask.id,
              });
              recoveryPending = !recoveryResult.ok;
            }
          }
        }

        const resumedCancellation = await clearScheduledCancellationTransition(
          company.id,
        );

        return c.json(
          {
            data: {
              tokenId: existingTokenId.toString(),
              companyId: company.id,
              planId: existingCatalogPlan?.id ?? catalogPlan.id,
              paymentAccount,
              alreadyActive: true,
              reconciled: true,
              resumedCancellation,
              invoiceId,
              paymentId,
              recoveryTaskId,
              recoveryPending,
            },
          },
          recoveryPending ? 202 : 200,
          corsHeaders(origin),
        );
      }

      return c.json(
        {
          error:
            `This payment account already has an active subscription for on-chain plan ${existingOnChainPlanId}. ` +
            "Use a plan change flow instead of activation.",
          data: {
            tokenId: existingTokenId.toString(),
            companyId: company.id,
            currentPlanId: existingCatalogPlan?.id ?? null,
            requestedPlanId: catalogPlan.id,
            paymentAccount,
            reconciled: true,
          },
        },
        409,
        corsHeaders(origin),
      );
    }

    let tokenBalance = 0n;
    let tokenAllowance = 0n;
    let tokenDecimals = 6;
    let tokenSymbol = "USDC";

    try {
      const [balanceResult, allowanceResult, decimalsResult, symbolResult] =
        await Promise.all([
          publicClient
            .readContract({
              address: acceptedTokenAddress,
              abi: erc20ReadAbi,
              functionName: "balanceOf",
              args: [paymentAccount as `0x${string}`],
            })
            .catch(() => 0n),
          publicClient
            .readContract({
              address: acceptedTokenAddress,
              abi: erc20ReadAbi,
              functionName: "allowance",
              args: [paymentAccount as `0x${string}`, autopayAddress as `0x${string}`],
            })
            .catch(() => 0n),
          publicClient
            .readContract({
              address: acceptedTokenAddress,
              abi: erc20ReadAbi,
              functionName: "decimals",
            })
            .then((value) => Number(value))
            .catch(() => 6),
          publicClient
            .readContract({
              address: acceptedTokenAddress,
              abi: erc20ReadAbi,
              functionName: "symbol",
            })
            .then((value) => String(value))
            .catch(() => "USDC"),
        ]);

      tokenBalance = BigInt(balanceResult ?? 0n);
      tokenAllowance = BigInt(allowanceResult ?? 0n);
      tokenDecimals = decimalsResult;
      tokenSymbol = symbolResult;
    } catch (err) {
      console.warn(
        "[subscriptions-activate] Warning reading token balance/allowance:",
        err,
      );
    }

    // If token allowance is less than chargeAmount, retry reading allowance up to 4 times
    // (1s delay between retries) to account for RPC node block indexing lag right after spending limit confirmation.
    if (tokenAllowance < chargeAmount) {
      for (let retry = 0; retry < 4; retry += 1) {
        await sleep(1000);
        try {
          const recheck = (await publicClient.readContract({
            address: acceptedTokenAddress,
            abi: erc20ReadAbi,
            functionName: "allowance",
              args: [paymentAccount as `0x${string}`, autopayAddress as `0x${string}`],
          })) as bigint;
          if (recheck >= chargeAmount) {
            tokenAllowance = recheck;
            break;
          }
        } catch {
          // Retry next tick
        }
      }
    }

    if (tokenBalance < chargeAmount) {
      return c.json(
        {
          error:
            `The payment account does not have enough ${tokenSymbol} for the first charge. ` +
            `Required: ${formatTokenAmount(chargeAmount, tokenDecimals, tokenSymbol)}. ` +
            `Available: ${formatTokenAmount(tokenBalance, tokenDecimals, tokenSymbol)}.`,
        },
        409,
        corsHeaders(origin),
      );
    }

    if (tokenAllowance < chargeAmount) {
      return c.json(
        {
          error:
            `The payment account has not approved enough ${tokenSymbol} for autopay. ` +
            `Required: ${formatTokenAmount(chargeAmount, tokenDecimals, tokenSymbol)}. ` +
            `Approved: ${formatTokenAmount(tokenAllowance, tokenDecimals, tokenSymbol)}.`,
        },
        409,
        corsHeaders(origin),
      );
    }

    const startTime = Number(autopayConfig?.startTime ?? 0n);
    const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
    const nowSeconds = Number(latestBlock.timestamp);
    if (startTime > nowSeconds) {
      const waitSeconds = startTime - nowSeconds;

      if (waitSeconds > 45) {
        return c.json(
          {
            error: `Autopay cannot start yet. The configured start time is ${new Date(startTime * 1000).toISOString()}.`,
          },
          409,
          corsHeaders(origin),
        );
      }

      await sleep((waitSeconds + 1) * 1000);
    }

    const walletConflict = await db.arcenCompany.findFirst({
      where: {
        teamId,
        environmentId: catalogPlan.environmentId ?? null,
        id: { not: company.id },
        OR: [
          { walletAddress: paymentAccount },
          {
            subscriptionState: {
              is: {
                walletAddress: paymentAccount,
              },
            },
          },
        ],
      },
      select: { id: true },
    });

    if (walletConflict) {
      return c.json(
        {
          error:
            "This payment account is already linked to a different company in this workspace environment. Reconcile the company mapping before activating the subscription.",
        },
        409,
        corsHeaders(origin),
      );
    }

    if (!submittedActivationTxHash) {
      const activationCalldata = encodeFunctionData({
        abi: ERC7579AutopayModuleABI,
        functionName: "execute",
        args: [paymentAccount as `0x${string}`, chargeAmount],
      });

      return c.json(
        {
          data: {
            activationRequired: true,
            paymentAccount,
            chargeAmountAtomic: chargeAmount.toString(),
            chargeAmountDisplay: formatTokenAmount(
              chargeAmount,
              tokenDecimals,
              tokenSymbol,
            ),
            preparedTransaction: {
              target: autopayAddress,
              value: "0",
              data: activationCalldata,
              functionSignature: "execute(address,uint256)",
            },
            verification: {
              chainId,
              acceptedToken: acceptedTokenAddress,
              merchantAddress,
              onChainPlanId: onChainPlanId.toString(),
            },
          },
        },
        202,
        corsHeaders(origin),
      );
    }

    const { transaction, receipt } = await readSubmittedActivationTransaction({
      publicClient,
      txHash: submittedActivationTxHash,
    });

    if (
      !transaction.to ||
      transaction.to.toLowerCase() !== autopayAddress.toLowerCase()
    ) {
      return c.json(
        { error: "Activation transaction was sent to the wrong contract." },
        409,
        corsHeaders(origin),
      );
    }

    const decoded = decodeFunctionData({
      abi: ERC7579AutopayModuleABI,
      data: transaction.input,
    });

    if (decoded.functionName !== "execute") {
      return c.json(
        { error: "Activation transaction must call AutopayModule.execute." },
        409,
        corsHeaders(origin),
      );
    }

    const [decodedAccount, decodedAmount] = decoded.args as [
      `0x${string}`,
      bigint,
    ];

    if (decodedAccount.toLowerCase() !== paymentAccount.toLowerCase()) {
      return c.json(
        { error: "Activation transaction targeted the wrong payment account." },
        409,
        corsHeaders(origin),
      );
    }

    if (decodedAmount !== chargeAmount) {
      return c.json(
        { error: "Activation transaction used the wrong billing amount." },
        409,
        corsHeaders(origin),
      );
    }

    if (receipt.status !== "success") {
      return c.json(
        { error: "Initial subscription activation transaction failed." },
        502,
        corsHeaders(origin),
      );
    }

    await assertReceiptFinalized({
      publicClient,
      receipt,
      label: "Initial subscription activation transaction",
    });

    const txHash = submittedActivationTxHash;

    const billingLogs = parseEventLogs({
      abi: ERC7579AutopayModuleABI,
      logs: receipt.logs,
      eventName: "BillingExecuted",
      strict: false,
    });
    const latestBillingLog = [...billingLogs].reverse().find((log) => {
      const args = log.args as
        | { account?: string; merchant?: string; tokenId?: bigint }
        | undefined;
      return (
        typeof args?.account === "string" &&
        typeof args?.merchant === "string" &&
        args.account.toLowerCase() === paymentAccount.toLowerCase() &&
        args.merchant.toLowerCase() === merchantAddress
      );
    });

    let tokenId = 0n;

    if (!latestBillingLog) {
      // Don't give up — try to resolve tokenId from SubscriptionMinted events
      // or directly from the on-chain registry. BillingExecuted may not be
      // indexed yet, but the subscription NFT may already exist.
      const fallbackTokenId = await readActiveWalletSubscriptionTokenId({
        publicClient,
        subscriptionRegistryAddress,
        wallet: paymentAccount,
      }).catch(() => 0n);

      if (fallbackTokenId <= 0n) {
        return c.json(
          {
            error:
              "Activation transaction is still being indexed. Please retry shortly.",
          },
          202,
          corsHeaders(origin),
        );
      }

      // Token found on-chain — proceed with fallback tokenId
      tokenId = fallbackTokenId;
    } else {
      tokenId = ((latestBillingLog?.args as { tokenId?: bigint } | undefined)
        ?.tokenId ?? 0n) as bigint;
    }

    const receiptBlock =
      receipt.blockNumber != null
        ? await publicClient.getBlock({ blockNumber: receipt.blockNumber })
        : null;
    const occurredAt =
      receiptBlock?.timestamp != null
        ? new Date(Number(receiptBlock.timestamp) * 1000)
        : new Date();

    const mintedLogs = parseEventLogs({
      abi: SubscriptionRegistryABI,
      logs: receipt.logs,
      eventName: "SubscriptionMinted",
      strict: false,
    });
    const renewedLogs = parseEventLogs({
      abi: SubscriptionRegistryABI,
      logs: receipt.logs,
      eventName: "SubscriptionRenewed",
      strict: false,
    });

    let expiresAt = 0n;

    const latestMintLog = [...mintedLogs].reverse().find((log) => {
      const args = log.args as
        | { subscriber?: string; tokenId?: bigint; expiration?: bigint }
        | undefined;
      return (
        typeof args?.subscriber === "string" &&
        args.subscriber.toLowerCase() === paymentAccount.toLowerCase() &&
        (tokenId <= 0n || args.tokenId === tokenId)
      );
    });

    if (latestMintLog) {
      const args = latestMintLog.args as {
        tokenId?: bigint;
        expiration?: bigint;
      };
      if (args.tokenId && args.tokenId > 0n) tokenId = args.tokenId;
      if (args.expiration && args.expiration > 0n) expiresAt = args.expiration;
    }

    const latestRenewLog =
      tokenId > 0n
        ? [...renewedLogs].reverse().find((log) => {
            const args = log.args as
              | { tokenId?: bigint; newExpiration?: bigint }
              | undefined;
            return args?.tokenId === tokenId;
          })
        : undefined;

    if (!latestMintLog && latestRenewLog) {
      const args = latestRenewLog.args as {
        newExpiration?: bigint;
      };
      if (args.newExpiration && args.newExpiration > 0n) {
        expiresAt = args.newExpiration;
      }
    }

    if (tokenId <= 0n) {
      tokenId = await readActiveWalletSubscriptionTokenId({
        publicClient,
        subscriptionRegistryAddress,
        wallet: paymentAccount,
      });
    }

    if (tokenId <= 0n) {
      throw new Error(
        "Activation transaction succeeded, but no active subscription token could be resolved for the payment account.",
      );
    }

    if (expiresAt <= 0n) {
      expiresAt = (await publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "expiresAt",
        args: [tokenId],
      })) as bigint;
    }

    const subscriberEmail = await resolveBillingRecipientEmail({
      teamId,
      environmentId: catalogPlan.environmentId ?? null,
      explicitEmail:
        parsed.data.subscriberEmail ?? sessionDefaults?.userEmail ?? null,
      accessTokenUserId: embedTokenContext?.userId ?? null,
      accessTokenCompanyId: embedTokenContext?.companyId ?? null,
      companyId: company.id,
      walletAddress: paymentAccount,
    });

    const finalizationPayload = {
      companyId: company.id,
      customerUserId:
        embedTokenContext?.userId ?? sessionDefaults?.userId ?? null,
      environmentId: catalogPlan.environmentId ?? null,
      walletAddress: paymentAccount,
      catalogPlanId: catalogPlan.id,
      catalogPlanName: catalogPlan.name,
      billingPeriod: resolvedBillingPeriod,
      customerName:
        typeof activationCompanyInput.name === "string" &&
        activationCompanyInput.name.trim()
          ? activationCompanyInput.name.trim()
          : null,
      onChainPlanId: onChainPlanId.toString(),
      onChainTokenId: tokenId.toString(),
      expiration: expiresAt.toString(),
      txHash,
      amount: Number(chargeAmount) / 1e6,
      currency: "USDC",
      merchantAddress,
      acceptedToken: catalogPlan.acceptedToken ?? null,
      subscriberEmail,
      occurredAt: occurredAt.toISOString(),
      previousPlanId: previousCompany?.activePlanId ?? null,
      chainId,
    };

    let recoveryTaskId: string | null = null;
    let recoveryPending = false;
    let invoiceId: string | null = null;
    let paymentId: string | null = null;

    try {
      const finalization = await finalizeSubscriptionActivation({
        teamId,
        payload: finalizationPayload,
        source: "subscription.activate",
      });
      invoiceId = finalization.invoiceId;
      paymentId = finalization.paymentId;
    } catch (finalizationError) {
      console.error(
        "[subscriptions/activate] Immediate billing finalization failed; queuing recovery task.",
        finalizationError,
      );

      const recoveryTask = await enqueueSubscriptionActivationRecovery({
        teamId,
        ...finalizationPayload,
        occurredAt: new Date(finalizationPayload.occurredAt),
      });
      recoveryTaskId = recoveryTask.id;

      const recoveryResult = await processBillingRecoveryTask({
        taskId: recoveryTask.id,
      });
      recoveryPending = !recoveryResult.ok;
    }

    return c.json(
      {
        data: {
          tokenId: tokenId.toString(),
          txHash,
          companyId: company.id,
          planId: catalogPlan.id,
          paymentAccount,
          invoiceId,
          paymentId,
          recoveryTaskId,
          recoveryPending,
        },
      },
      recoveryPending ? 202 : 200,
      corsHeaders(origin),
    );
  } catch (error) {
    console.error("[subscriptions/activate] Error during activation:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to activate subscription.";
    const normalized = normalizeActivationError(message);
    return c.json(
      {
        error: normalized.error,
        details: message,
      },
      normalized.status as any,
      corsHeaders(origin),
    );
  }
}
