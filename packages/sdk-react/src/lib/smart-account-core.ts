// ============================================================
//  @arcenpay/react — Smart Account Integration
//  ERC-7579 Kernel account provisioning with AutopayModule
//  PRD ARCENPAY-001 — Smart Account Provisioning
// ============================================================

import {
  prepareUserOperation,
} from "viem/account-abstraction";
import {
  toKernelSmartAccount,
  to7702KernelSmartAccount,
} from "permissionless/accounts";
import { createSmartAccountClient } from "permissionless/clients";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import {
  createPublicClient,
  http,
  parseSignature,
  type WalletClient,
  type PublicClient,
  type Account,
  encodeFunctionData,
} from "viem";
import { hashAuthorization } from "viem/utils";
import { sepolia, baseSepolia, base } from "viem/chains";
import {
  getContractAddresses,
  ERC7579AutopayModuleABI,
  SubscriptionRegistryABI,
  arcTestnet,
  botMainnet,
  botTestnet,
} from "../sdk";
import {
  applyVerificationGasFloor,
  resolveSmartAccountKernelConfig,
} from "../internal/core/smart-account-config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CHAIN_MAP: Record<number, any> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
  5042002: arcTestnet,
  677: botMainnet,
  968: botTestnet,
};

type SmartAccountProvider = "pimlico";

function getSmartAccountChainLabel(chainId: number): string {
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 8453) return "Base";
  if (chainId === 11155111) return "Sepolia";
  if (chainId === 5042002) return "Arc Testnet";
  if (chainId === 677) return "BOT Chain";
  if (chainId === 968) return "BOT Chain Testnet";
  return `Chain ${chainId}`;
}

function inferSmartAccountProvider(params: {
  bundlerUrl?: string;
  paymasterUrl?: string;
}): SmartAccountProvider {
  return "pimlico";
}

function getProviderDisplayName(provider: SmartAccountProvider): string {
  return provider === "pimlico" ? "Pimlico" : "Smart account";
}

function resolveSmartAccountUrls(params: {
  projectId?: string;
  chainId: number;
  bundlerUrl?: string;
  paymasterUrl?: string;
}) {
  if (params.bundlerUrl && params.paymasterUrl) {
    return {
      bundlerUrl: params.bundlerUrl,
      paymasterUrl: params.paymasterUrl,
      hasConfiguredUrls: true,
    };
  }

  const specificBundlerRpc =
    process.env[`NEXT_PUBLIC_BUNDLER_RPC_URL_${params.chainId}`] ||
    process.env[`NEXT_PUBLIC_PIMLICO_BUNDLER_RPC_URL_${params.chainId}`];
  const genericBundlerRpc =
    process.env.NEXT_PUBLIC_BUNDLER_RPC_URL ||
    process.env.NEXT_PUBLIC_PIMLICO_BUNDLER_RPC_URL;
  const specificPaymasterRpc =
    process.env[`NEXT_PUBLIC_PAYMASTER_RPC_URL_${params.chainId}`] ||
    process.env[`NEXT_PUBLIC_PIMLICO_PAYMASTER_RPC_URL_${params.chainId}`];
  const genericPaymasterRpc =
    process.env.NEXT_PUBLIC_PAYMASTER_RPC_URL ||
    process.env.NEXT_PUBLIC_PIMLICO_PAYMASTER_RPC_URL;
  const specificPimlicoRpcUrl =
    process.env[`NEXT_PUBLIC_PIMLICO_RPC_URL_${params.chainId}`];
  const genericPimlicoRpcUrl = process.env.NEXT_PUBLIC_PIMLICO_RPC_URL;
  const specificPimlicoRpc =
    process.env[`NEXT_PUBLIC_PIMLICO_RPC_${params.chainId}`];
  const genericPimlicoRpc = process.env.NEXT_PUBLIC_PIMLICO_RPC;
  const specificPimlicoApiKey =
    process.env[`NEXT_PUBLIC_PIMLICO_API_KEY_${params.chainId}`];
  const genericPimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
  const defaultPimlicoV2 =
    specificPimlicoApiKey || genericPimlicoApiKey
      ? `https://api.pimlico.io/v2/${params.chainId}/rpc?apikey=${
          specificPimlicoApiKey || genericPimlicoApiKey
        }`
      : "";
  const hasConfiguredUrls = !!(
    params.bundlerUrl ||
    params.paymasterUrl ||
    specificBundlerRpc ||
    genericBundlerRpc ||
    specificPaymasterRpc ||
    genericPaymasterRpc ||
    specificPimlicoRpcUrl ||
    genericPimlicoRpcUrl ||
    specificPimlicoRpc ||
    genericPimlicoRpc ||
    specificPimlicoApiKey ||
    genericPimlicoApiKey
  );

  return {
    bundlerUrl:
      params.bundlerUrl ||
      specificBundlerRpc ||
      genericBundlerRpc ||
      specificPimlicoRpcUrl ||
      genericPimlicoRpcUrl ||
      specificPimlicoRpc ||
      genericPimlicoRpc ||
      defaultPimlicoV2,
    paymasterUrl:
      params.paymasterUrl ||
      specificPaymasterRpc ||
      genericPaymasterRpc ||
      specificPimlicoRpcUrl ||
      genericPimlicoRpcUrl ||
      specificPimlicoRpc ||
      genericPimlicoRpc ||
      defaultPimlicoV2,
    hasConfiguredUrls,
  };
}

/**
 * Chains the HOSTED smart-account provider (Pimlico) documents support for,
 * restricted to the networks ArcenPay actually targets.
 *
 * WHY THIS EXISTS
 * ---------------
 * `resolveSmartAccountUrls()` synthesises a Pimlico endpoint for whatever chain
 * is active, purely because an API key is present:
 *
 *     https://api.pimlico.io/v2/<chainId>/rpc?apikey=…
 *
 * That makes `hasSmartAccountInfrastructure()` report `true` on EVERY chain —
 * including chains Pimlico does not serve. The SDK then attempted a sponsored
 * (ERC-4337) execution that could never succeed and surfaced a raw provider
 * error to the end user:
 *
 *     Details: chain "677" is not supported   (pimlico_getUserOperationGasPrice)
 *
 * 677 (BOT Chain Mainnet) and 968 (BOT Chain Testnet / BOHR) are NOT in
 * Pimlico's supported list, so sponsorship is unavailable there. On those
 * chains the correct behaviour is a normal transaction where the connected
 * wallet pays its own gas — which this gate allows by reporting no
 * infrastructure, letting the SDK take the direct-wallet path.
 *
 * Source: https://docs.pimlico.io/guides/supported-chains
 * Note 5042 (Arc Mainnet) and 5042002 (Arc Testnet) ARE supported.
 */
export const HOSTED_SMART_ACCOUNT_SUPPORTED_CHAIN_IDS: ReadonlySet<number> = new Set([
  1, // Ethereum
  11155111, // Ethereum Sepolia
  8453, // Base
  84532, // Base Sepolia
  137, // Polygon
  42161, // Arbitrum One
  10, // Optimism
  5042, // Arc Mainnet
  5042002, // Arc Testnet
]);

/**
 * True when `url` is a Pimlico endpoint for a chain Pimlico cannot serve.
 *
 * Deliberately narrow: only Pimlico URLs are judged, so a self-hosted or
 * third-party bundler configured for any chain is never second-guessed. Slug
 * URLs (e.g. `/v2/base/rpc`) are left alone for the same reason.
 */
export function isHostedSmartAccountUrlForUnsupportedChain(
  url: string | null | undefined,
): boolean {
  if (!url) return false;
  const match = /api\.pimlico\.io\/v2\/([^/?#]+)\/rpc/i.exec(url);
  if (!match) return false;

  const chainId = Number.parseInt(match[1], 10);
  if (!Number.isFinite(chainId) || chainId <= 0) return false;

  return !HOSTED_SMART_ACCOUNT_SUPPORTED_CHAIN_IDS.has(chainId);
}

export function hasSmartAccountInfrastructure(input: {
  projectId?: string;
  chainId: number;
  bundlerUrl?: string;
  paymasterUrl?: string;
}): boolean {
  const resolved = resolveSmartAccountUrls(input);

  // A Pimlico endpoint for an unsupported chain is not infrastructure — it is a
  // guaranteed runtime failure. Report "none" so the caller uses the direct
  // wallet transaction path (the user pays gas) instead of throwing.
  if (
    isHostedSmartAccountUrlForUnsupportedChain(resolved.bundlerUrl) ||
    isHostedSmartAccountUrlForUnsupportedChain(resolved.paymasterUrl)
  ) {
    return false;
  }

  return resolved.hasConfiguredUrls;
}

function resolveSmartAccountHeaders(_params: {
  chainId: number;
  bundlerUrl?: string;
  paymasterUrl?: string;
}) {
  return undefined;
}

function isSmartAccountInitCodeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  return (
    lower.includes("aa13") ||
    lower.includes("initcode failed") ||
    lower.includes("initcode reverted during gas estimation") ||
    lower.includes("smart-account deployment") ||
    (lower.includes("initcode") && lower.includes("oog"))
  );
}

function normalizeSmartAccountError(
  error: unknown,
  params: {
    projectId?: string;
    chainId: number;
    bundlerUrl?: string;
    paymasterUrl?: string;
    hasConfiguredUrls?: boolean;
  },
): Error {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const chainLabel = getSmartAccountChainLabel(params.chainId);
  const usingDefaultUrls = !params.hasConfiguredUrls;
  const provider = inferSmartAccountProvider({
    bundlerUrl: params.bundlerUrl,
    paymasterUrl: params.paymasterUrl,
  });
  const providerName = getProviderDisplayName(provider);

  if (message.includes("ChainId not found")) {
    const nextStep = usingDefaultUrls
      ? `Enable ${chainLabel} for ${providerName}, or set bundler/paymaster URLs directly.`
      : `The configured ${providerName} endpoint does not recognize ${chainLabel}. Verify the provider supports chain ${params.chainId} or replace the override URLs. Bundler URL: ${params.bundlerUrl ?? "n/a"}. Paymaster URL: ${params.paymasterUrl ?? "n/a"}.`;

    return new Error(
      `${providerName} is not configured for ${chainLabel} (chain ${params.chainId}). ${nextStep}`,
    );
  }

  if (message.includes("No RPC URL found for chainId")) {
    const nextStep = usingDefaultUrls
      ? `${providerName} accepted the request but does not have an upstream RPC configured for ${chainLabel}. Enable chain ${params.chainId} in the provider project or provide working chain-specific bundler/paymaster URLs.`
      : `The configured ${providerName} endpoint is reachable, but it reports no upstream RPC for ${chainLabel} (chain ${params.chainId}). Confirm the provider has this custom chain enabled server-side and that the exact override URLs are valid. Bundler URL: ${params.bundlerUrl ?? "n/a"}. Paymaster URL: ${params.paymasterUrl ?? "n/a"}.`;

    return new Error(
      `${providerName} cannot sponsor ${chainLabel} right now because its backend has no RPC configured for chain ${params.chainId}. ${nextStep}`,
    );
  }

  if (message.includes("No API provider supports the requested chainId")) {
    return new Error(
      `${providerName} does not currently serve ${chainLabel} (chain ${params.chainId}) on the configured RPC endpoint. Verify the provider has enabled that chain for your project. Bundler URL: ${params.bundlerUrl ?? "n/a"}. Paymaster URL: ${params.paymasterUrl ?? "n/a"}.`,
    );
  }

  if (message.toLowerCase().includes("implementation not allowed")) {
    return new Error(
      `${providerName} rejected the smart-account deployment on ${chainLabel} because the selected Kernel implementation is not allowlisted by the chain's factory. This usually means the app is using the wrong Kernel version or factory for chain ${params.chainId}. Bundler URL: ${params.bundlerUrl ?? "n/a"}. Paymaster URL: ${params.paymasterUrl ?? "n/a"}. Original error: ${message}`,
    );
  }

  if (
    message.includes("Invalid EIP-7702 authorization") ||
    message.toLowerCase().includes("recovered signer address does not match")
  ) {
    return new Error(
      `${providerName} rejected the sponsored ${chainLabel} request because the wallet signer address does not match the payment account sender for EIP-7702 gas sponsorship. Reconnect the same wallet that owns the subscription payment account and retry. Bundler URL: ${params.bundlerUrl ?? "n/a"}. Paymaster URL: ${params.paymasterUrl ?? "n/a"}. Original error: ${message}`,
    );
  }

  if (isSmartAccountInitCodeError(error)) {
    return new Error(
      `${providerName} could not simulate the smart-account deployment on ${chainLabel} (chain ${params.chainId}). The initCode reverted during gas estimation, which usually means the Kernel factory or EntryPoint is missing, underfunded, or incompatible for this chain. Bundler URL: ${params.bundlerUrl ?? "n/a"}. Paymaster URL: ${params.paymasterUrl ?? "n/a"}. Original error: ${message}`,
    );
  }

  if (
    message.includes("401") ||
    message.toLowerCase().includes("unauthorized") ||
    message.toLowerCase().includes("forbidden") ||
    message.toLowerCase().includes("invalid api key") ||
    message.toLowerCase().includes("invalid key")
  ) {
    return new Error(
      `Pimlico rejected the gas-sponsorship credentials for ${chainLabel}. Customer funds still come from the user's wallet; Pimlico is only sponsoring gas. Configure PIMLICO_API_KEY${params.chainId ? ` or PIMLICO_API_KEY_${params.chainId}` : ""} on the backend, or provide a full Pimlico RPC URL via PIMLICO_RPC_${params.chainId} / PIMLICO_RPC_URL_${params.chainId}, or NEXT_PUBLIC_PIMLICO_API_KEY${params.chainId ? ` / NEXT_PUBLIC_PIMLICO_API_KEY_${params.chainId}` : ""} in the dashboard environment, then retry.`,
    );
  }

  return error instanceof Error ? error : new Error(message);
}

async function requestHostedPaymasterData(params: {
  paymasterClient: ReturnType<typeof createPimlicoClient>;
  chainId: number;
  entryPointAddress: `0x${string}`;
  kernelAccountAddress: `0x${string}`;
  bundlerUrl: string;
  paymasterUrl: string;
  userOperation: any;
  mode: "estimate" | "final";
}) {
  const {
    chainId: _ignoredChainId,
    entryPointAddress: _ignoredEntryPointAddress,
    ...paymasterRequest
  } = params.userOperation as Record<string, unknown>;

  const sponsorship =
    params.mode === "estimate"
      ? await (params.paymasterClient as any).getPaymasterStubData({
          chainId: params.chainId,
          entryPointAddress: params.entryPointAddress,
          ...(paymasterRequest as any),
        })
      : await (params.paymasterClient as any).getPaymasterData({
          chainId: params.chainId,
          entryPointAddress: params.entryPointAddress,
          ...(paymasterRequest as any),
        });

  return sponsorship;
}

async function assertHostedSmartAccountProviderReady(params: {
  pimlicoClient: ReturnType<typeof createPimlicoClient>;
  projectId?: string;
  chainId: number;
  bundlerUrl: string;
  paymasterUrl: string;
  hasConfiguredUrls?: boolean;
}) {
  try {
    await (params.pimlicoClient as any).getUserOperationGasPrice();
  } catch (error) {
    throw normalizeSmartAccountError(error, {
      projectId: params.projectId,
      chainId: params.chainId,
      bundlerUrl: params.bundlerUrl,
      paymasterUrl: params.paymasterUrl,
      hasConfiguredUrls: params.hasConfiguredUrls,
    });
  }
}

export function isRecoverableSmartAccountFundingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  return (
    lower.includes("smart account does not have sufficient funds") ||
    lower.includes("sufficient funds to execute the user operation") ||
    lower.includes("insufficient funds") ||
    (lower.includes("user operation") && lower.includes("paymaster"))
  );
}

export function isPrefundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("didn't pay prefund") || message.includes("AA21");
}

export function isSmartAccountInfrastructureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  return (
    lower.includes("chainid not found") ||
    lower.includes("no api provider supports the requested chainid") ||
    lower.includes("http request failed") ||
    lower.includes("does not recognize") ||
    isSmartAccountInitCodeError(error) ||
    lower.includes("api.pimlico.io") ||
    lower.includes("pimlico")
  );
}

export function isUnsupportedEip7702AuthorizationError(
  error: unknown,
): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  return (
    lower.includes("could not sign the eip-7702 gas-sponsorship authorization") ||
    lower.includes("wallet_signauthorization") ||
    lower.includes("eth_sign") ||
    lower.includes("-32601") ||
    lower.includes("does not exist") ||
    lower.includes("is not available") ||
    lower.includes("does not support json-rpc accounts") ||
    lower.includes("wallet returned an unsupported") ||
    lower.includes("user rejected")
  );
}

/**
 * True when the failure is on the PROVIDER/infrastructure side rather than a
 * genuine business-logic rejection.
 *
 * The sponsored (ERC-4337) path depends on an external bundler and paymaster.
 * When either cannot serve the request — unsupported chain, method not found,
 * malformed parameters for that provider, transport failure, credit exhausted —
 * the user should still be able to complete the action, paying gas from their
 * own wallet. That is the documented fallback contract, and previously it only
 * fired for EIP-7702-specific errors, so a Pimlico "chain not supported" error
 * was shown to the end user as a dead end:
 *
 *     Details: chain "677" is not supported
 *
 * Explicitly EXCLUDES user rejection: if the user declined in their wallet we
 * must never silently submit a second transaction behind their back.
 */
export function isSmartAccountProviderUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return false;
  }

  return (
    // Provider cannot serve this chain / method.
    lower.includes("is not supported") ||
    lower.includes("not supported") ||
    lower.includes("unsupported") ||
    lower.includes("method not found") ||
    lower.includes("-32601") ||
    lower.includes("invalid params") ||
    lower.includes("invalid parameters") ||
    lower.includes("missing or invalid parameters") ||
    // Provider/transport failures.
    lower.includes("failed to fetch") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("api key") ||
    // Anything the smart-account layer itself named after the provider.
    lower.includes("pimlico") ||
    lower.includes("bundler") ||
    lower.includes("paymaster") ||
    lower.includes("useroperation") ||
    lower.includes("gas sponsorship")
  );
}

function isAlreadyDeployedSmartAccountError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  return (
    lower.includes("smart account has already been deployed") ||
    (lower.includes("already been deployed") &&
      (lower.includes("factory") || lower.includes("factorydata")))
  );
}

async function createKernelAccountForWallet(params: {
  walletClient: WalletClient;
  chainId: number;
  publicClient?: PublicClient;
  smartAccountAddress?: `0x${string}`;
}) {
  const chain = CHAIN_MAP[params.chainId] || baseSepolia;
  const kernelConfig = resolveSmartAccountKernelConfig(params.chainId);
  const entryPoint = {
    address: kernelConfig.entryPointAddress,
    version: kernelConfig.entryPointVersion,
  } as const;
  const publicClient =
    params.publicClient ??
    (createPublicClient({
      chain,
      transport: http(undefined, { retryCount: 4, retryDelay: 1000, timeout: 15_000 }),
    }) as PublicClient);

  const connectedWalletAddress = params.walletClient.account?.address;
  const use7702SponsoredExecution = Boolean(
    kernelConfig.entryPointVersion === "0.7" &&
      connectedWalletAddress &&
      params.smartAccountAddress &&
      connectedWalletAddress.toLowerCase() ===
        params.smartAccountAddress.toLowerCase(),
  );

  if (use7702SponsoredExecution) {
    const kernelAccount = await to7702KernelSmartAccount({
      client: publicClient,
      owner: params.walletClient as any,
      entryPoint: entryPoint as any,
    });

    return {
      publicClient,
      kernelAccount,
      sponsoredMode: "eip7702" as const,
    };
  }

  const kernelAccount = await toKernelSmartAccount({
    client: publicClient,
    owners: [params.walletClient as any],
    entryPoint: entryPoint as any,
    version: kernelConfig.version as any,
    ...(kernelConfig.factoryAddress
      ? { factoryAddress: kernelConfig.factoryAddress }
      : {}),
    ...(kernelConfig.metaFactoryAddress
      ? { metaFactoryAddress: kernelConfig.metaFactoryAddress }
      : {}),
    ...(kernelConfig.accountLogicAddress
      ? { accountLogicAddress: kernelConfig.accountLogicAddress }
      : {}),
    ...(kernelConfig.validatorAddress
      ? { validatorAddress: kernelConfig.validatorAddress }
      : {}),
    ...(typeof kernelConfig.useMetaFactory !== "undefined"
      ? { useMetaFactory: kernelConfig.useMetaFactory }
      : {}),
  });

  return {
    publicClient,
    kernelAccount,
    sponsoredMode: "counterfactual" as const,
  };
}

export async function getCounterfactualSmartAccountAddress(
  walletClient: WalletClient,
  chainId: number,
): Promise<`0x${string}`> {
  const chain = CHAIN_MAP[chainId] || baseSepolia;
  const publicClient = createPublicClient({
    chain,
    transport: http(undefined, { retryCount: 4, retryDelay: 1000, timeout: 15_000 }),
  }) as PublicClient;

  const { kernelAccount } = await createKernelAccountForWallet({
    walletClient,
    chainId,
    publicClient,
  });

  return kernelAccount.address;
}

export interface DeploySmartAccountConfig {
  /** Deprecated legacy project identifier. Prefer bundlerUrl + paymasterUrl via ArcenPay context. */
  projectId?: string;
  chainId: number;
  walletClient: WalletClient;
  bundlerUrl?: string;
  paymasterUrl?: string;
}

export interface SmartAccountResult {
  smartAccountAddress: `0x${string}`;
  installTxHash?: `0x${string}`;
  alreadyDeployed: boolean;
}

export interface RevokeAutopayConfig {
  projectId?: string;
  chainId: number;
  walletClient: WalletClient;
  smartAccountAddress: `0x${string}`;
  bundlerUrl?: string;
  paymasterUrl?: string;
}

export interface SmartAccountTransactionConfig {
  projectId?: string;
  chainId: number;
  walletClient: WalletClient;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
  smartAccountAddress?: `0x${string}`;
  bundlerUrl?: string;
  paymasterUrl?: string;
}

export interface UpdateAutopayConfigInput {
  projectId?: string;
  chainId: number;
  walletClient: WalletClient;
  smartAccountAddress: `0x${string}`;
  merchant: `0x${string}`;
  maxAmount: bigint;
  token: `0x${string}`;
  interval: number;
  startTime: bigint;
  planId: bigint;
  maxTotalAmount?: bigint;
  bundlerUrl?: string;
  paymasterUrl?: string;
}

export interface CancelSubscriptionInput {
  projectId?: string;
  chainId: number;
  walletClient: WalletClient;
  smartAccountAddress: `0x${string}`;
  tokenId: bigint;
  bundlerUrl?: string;
  paymasterUrl?: string;
}

async function createKernelExecutionContext(config: {
  projectId?: string;
  chainId: number;
  walletClient: WalletClient;
  smartAccountAddress?: `0x${string}`;
  bundlerUrl?: string;
  paymasterUrl?: string;
  forceDeployed?: boolean;
}) {
  const chain = CHAIN_MAP[config.chainId] || baseSepolia;
  const kernelConfig = resolveSmartAccountKernelConfig(config.chainId);
  const entryPoint = {
    address: kernelConfig.entryPointAddress,
    version: kernelConfig.entryPointVersion,
  } as const;
  const { bundlerUrl, paymasterUrl, hasConfiguredUrls } = resolveSmartAccountUrls({
    projectId: config.projectId,
    chainId: config.chainId,
    bundlerUrl: config.bundlerUrl,
    paymasterUrl: config.paymasterUrl,
  });
  const providerHeaders = resolveSmartAccountHeaders({
    chainId: config.chainId,
    bundlerUrl,
    paymasterUrl,
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(undefined, { retryCount: 4, retryDelay: 1000, timeout: 15_000 }),
  }) as PublicClient;

  const { kernelAccount, sponsoredMode } = await createKernelAccountForWallet({
    walletClient: config.walletClient,
    chainId: config.chainId,
    publicClient,
    smartAccountAddress: config.smartAccountAddress,
  });

  if (config.forceDeployed && sponsoredMode !== "eip7702") {
    (kernelAccount as any).isDeployed = async () => true;
    (kernelAccount as any).getFactoryArgs = async () => ({
      factory: undefined,
      factoryData: undefined,
    });
  }

  const pimlicoClient = createPimlicoClient({
    chain,
    transport: http(
      paymasterUrl,
      providerHeaders
        ? { fetchOptions: { headers: providerHeaders } }
        : undefined,
    ),
    entryPoint: entryPoint as any,
  });

  await assertHostedSmartAccountProviderReady({
    pimlicoClient,
    projectId: config.projectId,
    chainId: config.chainId,
    bundlerUrl,
    paymasterUrl,
    hasConfiguredUrls,
  });

  const kernelClient = createSmartAccountClient({
    account: kernelAccount,
    chain,
    client: publicClient,
    bundlerTransport: http(
      bundlerUrl,
      providerHeaders
        ? { fetchOptions: { headers: providerHeaders } }
        : undefined,
    ),
    paymaster: {
      getPaymasterStubData: async (userOperation: any) => {
        const sponsorship = await requestHostedPaymasterData({
          paymasterClient: pimlicoClient,
          chainId: config.chainId,
          entryPointAddress: entryPoint.address,
          kernelAccountAddress: kernelAccount.address,
          bundlerUrl,
          paymasterUrl,
          userOperation,
          mode: "estimate",
        });

        return {
          ...sponsorship,
          isFinal:
            "isFinal" in sponsorship ? Boolean(sponsorship.isFinal) : false,
        };
      },
      getPaymasterData: async (userOperation: any) =>
        requestHostedPaymasterData({
          paymasterClient: pimlicoClient,
          chainId: config.chainId,
          entryPointAddress: entryPoint.address,
          kernelAccountAddress: kernelAccount.address,
          bundlerUrl,
          paymasterUrl,
          userOperation,
          mode: "final",
        }),
    },
    userOperation: {
      prepareUserOperation: (async (client: any, args: any) => {
        const baseClient = Object.create(client) as typeof client;
        (baseClient as any).prepareUserOperation = undefined;

        return prepareUserOperation(
          baseClient as any,
          applyVerificationGasFloor(
            args as Record<string, unknown>,
            kernelConfig.verificationGasLimitFloor,
          ) as any,
        );
      }) as any,
      estimateFeesPerGas: async () =>
        (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  } as any);

  return {
    publicClient,
    kernelAccount,
    kernelClient,
    bundlerUrl,
    paymasterUrl,
    hasConfiguredUrls,
    sponsoredMode,
  };
}

async function buildEip7702Authorization(params: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  chainId: number;
  sender: `0x${string}`;
  implementation: `0x${string}`;
}): Promise<{
  address: `0x${string}`;
  chainId: number;
  nonce: number;
  r: `0x${string}`;
  s: `0x${string}`;
  yParity: number;
}> {
  const authorizationNonce = await params.publicClient.getTransactionCount({
    address: params.sender,
    blockTag: "pending",
  });
  const authorizationRequest = {
    address: params.implementation,
    chainId: params.chainId,
    nonce: authorizationNonce,
  };
  const account = params.walletClient.account as
    | (Account & {
        signAuthorization?: (input: {
          address: `0x${string}`;
          chainId: number;
          nonce: number;
        }) => Promise<{
          address: `0x${string}`;
          chainId: number;
          nonce: number;
          r: `0x${string}`;
          s: `0x${string}`;
          yParity: number;
        }>;
      })
    | undefined;

  if (account?.type === "local" && typeof account.signAuthorization === "function") {
    return account.signAuthorization(authorizationRequest);
  }

  function isSignedAuthorizationObject(value: unknown): value is {
    address: `0x${string}`;
    chainId: number;
    nonce: number;
    r: `0x${string}`;
    s: `0x${string}`;
    yParity: number;
  } {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.address === "string" &&
      typeof candidate.chainId === "number" &&
      typeof candidate.nonce === "number" &&
      typeof candidate.r === "string" &&
      typeof candidate.s === "string" &&
      typeof candidate.yParity === "number"
    );
  }

  async function tryWalletRpcAuthorization(method: string, paramsList: unknown[]) {
    const result = await (params.walletClient as any).request({
      method,
      params: paramsList,
    });

    if (typeof result === "string") {
      const parsed = parseSignature(result as `0x${string}`);
      return {
        ...authorizationRequest,
        r: parsed.r,
        s: parsed.s,
        yParity: parsed.yParity,
      };
    }

    if (isSignedAuthorizationObject(result)) {
      return result;
    }

    throw new Error(
      `Wallet returned an unsupported ${method} authorization response shape.`,
    );
  }

  const signingFailures: string[] = [];

  const signingAttempts: Array<() => Promise<{
    address: `0x${string}`;
    chainId: number;
    nonce: number;
    r: `0x${string}`;
    s: `0x${string}`;
    yParity: number;
  }>> = [
    () =>
      tryWalletRpcAuthorization("wallet_signAuthorization", [
        authorizationRequest,
      ]),
    () =>
      tryWalletRpcAuthorization("wallet_signAuthorization", [
        {
          account: params.sender,
          ...authorizationRequest,
        },
      ]),
    async () => {
      const signed = (await (params.walletClient as any).request({
        method: "eth_sign",
        params: [params.sender, hashAuthorization(authorizationRequest)],
      })) as `0x${string}`;
      const parsed = parseSignature(signed);

      return {
        ...authorizationRequest,
        r: parsed.r,
        s: parsed.s,
        yParity: parsed.yParity,
      };
    },
  ];

  for (const attempt of signingAttempts) {
    try {
      return await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      signingFailures.push(message);
    }
  }

  try {
    throw new Error(signingFailures.filter(Boolean).join(" | "));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    throw new Error(
      `This wallet could not sign the EIP-7702 gas-sponsorship authorization for ${getSmartAccountChainLabel(params.chainId)}. Customer funds still come from the user's wallet, but EOA-owned sponsored execution needs a wallet-exposed authorization signer before the Pimlico user operation can be sent. This wallet either does not expose that signer to the dapp, or it rejected the request. Original error: ${message}`,
    );
  }
}

async function deployKernelAccountIfNeeded(config: {
  projectId?: string;
  chainId: number;
  walletClient: WalletClient;
  smartAccountAddress?: `0x${string}`;
  bundlerUrl?: string;
  paymasterUrl?: string;
}): Promise<SmartAccountResult> {
  const {
    publicClient,
    kernelAccount,
    kernelClient,
    bundlerUrl,
    paymasterUrl,
    hasConfiguredUrls,
  } = await createKernelExecutionContext(config);

  const smartAccountAddress = kernelAccount.address;
  const code = await publicClient.getCode({ address: smartAccountAddress });
  const alreadyDeployed = !!code && code !== "0x";

  if (alreadyDeployed) {
    return {
      smartAccountAddress,
      installTxHash: undefined,
      alreadyDeployed: true,
    };
  }

  try {
    const txHash = await (kernelClient as any).sendTransaction({
      to: smartAccountAddress,
      value: 0n,
      data: "0x",
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      smartAccountAddress,
      installTxHash: txHash,
      alreadyDeployed: false,
    };
  } catch (error) {
    throw normalizeSmartAccountError(error, {
      projectId: config.projectId,
      chainId: config.chainId,
      bundlerUrl,
      paymasterUrl,
      hasConfiguredUrls,
    });
  }
}

/**
 * Deploy a Kernel smart account with a no-op self-call so later smart-account
 * transactions can assume the account already exists on-chain.
 */
export async function deploySmartAccount(
  config: DeploySmartAccountConfig,
): Promise<SmartAccountResult> {
  return deployKernelAccountIfNeeded(config);
}

/**
 * Revoke autopay module state for an existing smart account.
 * This calls module `onUninstall(0x)` through the smart account executor.
 */
export async function revokeAutopayModule(
  config: RevokeAutopayConfig,
): Promise<{ txHash?: `0x${string}`; alreadyRevoked: boolean }> {
  const chain = CHAIN_MAP[config.chainId] || baseSepolia;
  const contracts = getContractAddresses(config.chainId);

  if (!contracts.autopayModule) {
    throw new Error(
      "Automatic payment system address is not configured for this chain.",
    );
  }

  const { bundlerUrl, paymasterUrl, hasConfiguredUrls } = resolveSmartAccountUrls({
    projectId: config.projectId,
    chainId: config.chainId,
    bundlerUrl: config.bundlerUrl,
    paymasterUrl: config.paymasterUrl,
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(undefined, { retryCount: 4, retryDelay: 1000, timeout: 15_000 }),
  }) as PublicClient;

  const initialized = (await publicClient.readContract({
    address: contracts.autopayModule as `0x${string}`,
    abi: ERC7579AutopayModuleABI,
    functionName: "isInitialized",
    args: [config.smartAccountAddress],
  })) as boolean;

  if (!initialized) {
    return { alreadyRevoked: true };
  }

  const { kernelAccount, kernelClient } = await createKernelExecutionContext({
    projectId: config.projectId,
    chainId: config.chainId,
    walletClient: config.walletClient,
    smartAccountAddress: config.smartAccountAddress,
    bundlerUrl,
    paymasterUrl,
  });

  if (
    kernelAccount.address.toLowerCase() !==
    config.smartAccountAddress.toLowerCase()
  ) {
    throw new Error(
      `Wallet account mismatch. Expected ${config.smartAccountAddress}, got ${kernelAccount.address}.`,
    );
  }

  const revokeData = encodeFunctionData({
    abi: ERC7579AutopayModuleABI,
    functionName: "onUninstall",
    args: ["0x"],
  });

  try {
    const txHash = await (kernelClient as any).sendTransaction({
      to: contracts.autopayModule as `0x${string}`,
      data: revokeData,
      value: 0n,
    });

    return { txHash, alreadyRevoked: false };
  } catch (error) {
    throw normalizeSmartAccountError(error, {
      projectId: config.projectId,
      chainId: config.chainId,
      bundlerUrl,
      paymasterUrl,
      hasConfiguredUrls,
    });
  }
}

/**
 * Sends a transaction through the caller's Kernel smart account and waits
 * for the resulting on-chain receipt. This keeps follow-up checkout actions
 * originating from the smart account rather than the owner EOA.
 */
export async function sendSmartAccountTransaction(
  config: SmartAccountTransactionConfig,
): Promise<{
  smartAccountAddress: `0x${string}`;
  txHash: `0x${string}`;
}> {
  async function execute(forceDeployed = false) {
    const {
      publicClient,
      kernelAccount,
      kernelClient,
      bundlerUrl,
      paymasterUrl,
      hasConfiguredUrls,
      sponsoredMode,
    } = await createKernelExecutionContext({
      projectId: config.projectId,
      chainId: config.chainId,
      walletClient: config.walletClient,
      smartAccountAddress: config.smartAccountAddress,
      bundlerUrl: config.bundlerUrl,
      paymasterUrl: config.paymasterUrl,
      forceDeployed,
    });

    if (
      config.smartAccountAddress &&
      kernelAccount.address.toLowerCase() !==
        config.smartAccountAddress.toLowerCase()
    ) {
      throw new Error(
        `Wallet account mismatch. Expected ${config.smartAccountAddress}, got ${kernelAccount.address}.`,
      );
    }

    try {
      const requiresEip7702Authorization =
        sponsoredMode === "eip7702" && !(await (kernelAccount as any).isDeployed());
      const authorization = requiresEip7702Authorization
        ? await buildEip7702Authorization({
            walletClient: config.walletClient,
            publicClient,
            chainId: config.chainId,
            sender: kernelAccount.address,
            implementation: (kernelAccount as any).implementation as `0x${string}`,
          })
        : undefined;
      const txHash = await (kernelClient as any).sendTransaction({
        to: config.to,
        data: config.data,
        value: config.value ?? 0n,
        authorization,
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      return {
        smartAccountAddress: kernelAccount.address,
        txHash,
      };
    } catch (error) {
      throw normalizeSmartAccountError(error, {
        projectId: config.projectId,
        chainId: config.chainId,
        bundlerUrl,
        paymasterUrl,
        hasConfiguredUrls,
      });
    }
  }

  try {
    return await execute(false);
  } catch (error) {
    const uses7702SponsoredExecution = Boolean(
      config.smartAccountAddress &&
        config.walletClient.account?.address &&
        config.walletClient.account.address.toLowerCase() ===
          config.smartAccountAddress.toLowerCase(),
    );

    if (isSmartAccountInitCodeError(error) && !uses7702SponsoredExecution) {
      await deployKernelAccountIfNeeded({
        projectId: config.projectId,
        chainId: config.chainId,
        walletClient: config.walletClient,
        smartAccountAddress: config.smartAccountAddress,
        bundlerUrl: config.bundlerUrl,
        paymasterUrl: config.paymasterUrl,
      });
      return await execute(true);
    }

    if (isAlreadyDeployedSmartAccountError(error)) {
      return await execute(true);
    }
    throw error;
  }
}

export async function updateAutopayConfig(
  config: UpdateAutopayConfigInput,
): Promise<{
  smartAccountAddress: `0x${string}`;
  txHash: `0x${string}`;
}> {
  const contracts = getContractAddresses(config.chainId);
  if (!contracts.autopayModule) {
    throw new Error(
      "Automatic payment system address is not configured for this chain.",
    );
  }

  const data = encodeFunctionData({
    abi: ERC7579AutopayModuleABI as any,
    functionName: "updateConfig",
    args: [
      {
        merchant: config.merchant,
        maxAmount: config.maxAmount,
        token: config.token,
        interval: config.interval,
        startTime: config.startTime,
        planId: config.planId,
        maxTotalAmount: config.maxTotalAmount ?? 0n,
      },
    ],
  });

  return sendSmartAccountTransaction({
    projectId: config.projectId,
    chainId: config.chainId,
    walletClient: config.walletClient,
    smartAccountAddress: config.smartAccountAddress,
    to: contracts.autopayModule as `0x${string}`,
    data,
    bundlerUrl: config.bundlerUrl,
    paymasterUrl: config.paymasterUrl,
  });
}

export async function cancelSubscription(
  config: CancelSubscriptionInput,
): Promise<{
  smartAccountAddress: `0x${string}`;
  txHash: `0x${string}`;
}> {
  const contracts = getContractAddresses(config.chainId);
  if (!contracts.subscriptionRegistry) {
    throw new Error(
      "Subscription registry address is not configured for this chain.",
    );
  }

  const data = encodeFunctionData({
    abi: SubscriptionRegistryABI as any,
    functionName: "cancelSubscription",
    args: [config.tokenId],
  });

  return sendSmartAccountTransaction({
    projectId: config.projectId,
    chainId: config.chainId,
    walletClient: config.walletClient,
    smartAccountAddress: config.smartAccountAddress,
    to: contracts.subscriptionRegistry as `0x${string}`,
    data,
    bundlerUrl: config.bundlerUrl,
    paymasterUrl: config.paymasterUrl,
  });
}
