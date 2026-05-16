// ============================================================
//  @arcenpay/react — Smart Account Integration
//  ERC-7579 Kernel account provisioning with AutopayModule
//  PRD ARCENPAY-001 — Smart Account Provisioning
// ============================================================

import {
  prepareUserOperation,
} from "viem/account-abstraction";
import { toKernelSmartAccount } from "permissionless/accounts";
import { createSmartAccountClient } from "permissionless/clients";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import {
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  encodeFunctionData,
} from "viem";
import { sepolia, baseSepolia, base } from "viem/chains";
import {
  getContractAddresses,
  ERC7579AutopayModuleABI,
  SubscriptionRegistryABI,
  arcTestnet,
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
};

type SmartAccountProvider = "pimlico";

function getSmartAccountChainLabel(chainId: number): string {
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 8453) return "Base";
  if (chainId === 11155111) return "Sepolia";
  if (chainId === 5042002) return "Arc Testnet";
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
    specificPimlicoRpc ||
    genericPimlicoRpc ||
    specificPimlicoApiKey ||
    genericPimlicoApiKey
  );

  return {
    bundlerUrl:
      params.bundlerUrl ||
      specificPimlicoRpc ||
      genericPimlicoRpc ||
      defaultPimlicoV2,
    paymasterUrl:
      params.paymasterUrl ||
      specificPimlicoRpc ||
      genericPimlicoRpc ||
      defaultPimlicoV2,
    hasConfiguredUrls,
  };
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

  if (isSmartAccountInitCodeError(error)) {
    return new Error(
      `${providerName} could not simulate the smart-account deployment on ${chainLabel} (chain ${params.chainId}). The initCode reverted during gas estimation, which usually means the Kernel factory or EntryPoint is missing, underfunded, or incompatible for this chain. Bundler URL: ${params.bundlerUrl ?? "n/a"}. Paymaster URL: ${params.paymasterUrl ?? "n/a"}. Original error: ${message}`,
    );
  }

  if (
    message.includes("401") ||
    message.toLowerCase().includes("unauthorized") ||
    message.toLowerCase().includes("forbidden")
  ) {
    return new Error(
      `Pimlico rejected the request credentials for ${chainLabel}. Set NEXT_PUBLIC_PIMLICO_API_KEY${params.chainId ? ` or NEXT_PUBLIC_PIMLICO_API_KEY_${params.chainId}` : ""} in the dashboard environment and retry.`,
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
  mode: "stub" | "final";
}) {
  const {
    chainId: _ignoredChainId,
    entryPointAddress: _ignoredEntryPointAddress,
    ...paymasterRequest
  } = params.userOperation as Record<string, unknown>;

  const sponsorship =
    params.mode === "stub"
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
      transport: http(),
    }) as PublicClient);

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

  return { publicClient, kernelAccount };
}

export async function getCounterfactualSmartAccountAddress(
  walletClient: WalletClient,
  chainId: number,
): Promise<`0x${string}`> {
  const chain = CHAIN_MAP[chainId] || baseSepolia;
  const publicClient = createPublicClient({
    chain,
    transport: http(),
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
    transport: http(),
  }) as PublicClient;

  const { kernelAccount } = await createKernelAccountForWallet({
    walletClient: config.walletClient,
    chainId: config.chainId,
    publicClient,
  });

  if (config.forceDeployed) {
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
          mode: "stub",
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
  };
}

async function deployKernelAccountIfNeeded(config: {
  projectId?: string;
  chainId: number;
  walletClient: WalletClient;
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
    transport: http(),
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
    } = await createKernelExecutionContext({
      projectId: config.projectId,
      chainId: config.chainId,
      walletClient: config.walletClient,
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
      const txHash = await (kernelClient as any).sendTransaction({
        to: config.to,
        data: config.data,
        value: config.value ?? 0n,
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
    if (isSmartAccountInitCodeError(error)) {
      await deployKernelAccountIfNeeded({
        projectId: config.projectId,
        chainId: config.chainId,
        walletClient: config.walletClient,
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
