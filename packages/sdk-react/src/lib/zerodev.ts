// ============================================================
//  @arcenpay/react — ZeroDev Smart Account Integration
//  ERC-7579 Kernel account provisioning with AutopayModule
//  PRD ARCENPAY-001 — Smart Account Provisioning
// ============================================================

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  constants as zeroDevConstants,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CHAIN_MAP: Record<number, any> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
  5042002: arcTestnet,
};

const ENTRY_POINT = zeroDevConstants.getEntryPoint("0.7");
const ENTRY_POINT_ADDRESS = ENTRY_POINT.address;
const KERNEL_VERSION = zeroDevConstants.KERNEL_V3_1;

function getZeroDevChainLabel(chainId: number): string {
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 8453) return "Base";
  if (chainId === 11155111) return "Sepolia";
  if (chainId === 5042002) return "Arc Testnet";
  return `Chain ${chainId}`;
}

function resolveZeroDevUrls(params: {
  projectId?: string;
  chainId: number;
  bundlerUrl?: string;
  paymasterUrl?: string;
}) {
  if (params.bundlerUrl && params.paymasterUrl) {
    return { bundlerUrl: params.bundlerUrl, paymasterUrl: params.paymasterUrl, hasConfiguredUrls: true };
  }

  const specificUnified =
    process.env[`NEXT_PUBLIC_ZERODEV_RPC_${params.chainId}`];
  const specificBundler =
    process.env[`NEXT_PUBLIC_ZERODEV_BUNDLER_RPC_${params.chainId}`];
  const specificPaymaster =
    process.env[`NEXT_PUBLIC_ZERODEV_PAYMASTER_RPC_${params.chainId}`];
  const genericUnified = process.env.NEXT_PUBLIC_ZERODEV_RPC;
  const genericBundler = process.env.NEXT_PUBLIC_ZERODEV_BUNDLER_RPC;
  const genericPaymaster = process.env.NEXT_PUBLIC_ZERODEV_PAYMASTER_RPC;
  const defaultUnifiedV3 = params.projectId
    ? `https://rpc.zerodev.app/api/v3/${params.projectId}/chain/${params.chainId}`
    : "";
  const hasConfiguredUrls = !!(
    params.bundlerUrl ||
    params.paymasterUrl ||
    specificUnified ||
    specificBundler ||
    specificPaymaster ||
    genericUnified ||
    genericBundler ||
    genericPaymaster
  );

  return {
    bundlerUrl:
      params.bundlerUrl ||
      specificUnified ||
      specificBundler ||
      genericUnified ||
      genericBundler ||
      defaultUnifiedV3 ||
      (params.projectId
        ? `https://rpc.zerodev.app/api/v2/bundler/${params.projectId}`
        : ""),
    paymasterUrl:
      params.paymasterUrl ||
      specificUnified ||
      specificPaymaster ||
      genericUnified ||
      genericPaymaster ||
      defaultUnifiedV3 ||
      (params.projectId
        ? `https://rpc.zerodev.app/api/v2/paymaster/${params.projectId}`
        : ""),
    hasConfiguredUrls,
  };
}

function normalizeZeroDevError(
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
  const chainLabel = getZeroDevChainLabel(params.chainId);
  const usingDefaultUrls = !params.hasConfiguredUrls;

  if (message.includes("ChainId not found")) {
    const nextStep = usingDefaultUrls
      ? `Enable ${chainLabel} for ZeroDev project ${params.projectId ?? "(unknown)"}, or set bundler/paymaster URLs directly.`
      : `The configured ZeroDev endpoint does not recognize ${chainLabel} for project ${params.projectId ?? "(unknown)"}. Verify the project supports chain ${params.chainId} or replace the override URLs. Bundler URL: ${params.bundlerUrl ?? "n/a"}. Paymaster URL: ${params.paymasterUrl ?? "n/a"}.`;

    return new Error(
      `ZeroDev project ${params.projectId ?? "(unknown)"} is not configured for ${chainLabel} (chain ${params.chainId}). ${nextStep}`,
    );
  }

  return error instanceof Error ? error : new Error(message);
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
  return (
    message.includes("didn't pay prefund") ||
    message.includes("AA21")
  );
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

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: walletClient as any,
    entryPoint: ENTRY_POINT as any,
    kernelVersion: KERNEL_VERSION,
  });

  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: ecdsaValidator },
    entryPoint: ENTRY_POINT as any,
    kernelVersion: KERNEL_VERSION,
  } as any);

  return kernelAccount.address;
}

export interface DeploySmartAccountConfig {
  /** (Deprecated) ZeroDev project ID — prefer bundlerUrl + paymasterUrl via ArcenPay context. */
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
}) {
  const chain = CHAIN_MAP[config.chainId] || baseSepolia;
  const { bundlerUrl, paymasterUrl, hasConfiguredUrls } = resolveZeroDevUrls({
    projectId: config.projectId,
    chainId: config.chainId,
    bundlerUrl: config.bundlerUrl,
    paymasterUrl: config.paymasterUrl,
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  }) as PublicClient;

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: config.walletClient as any,
    entryPoint: ENTRY_POINT as any,
    kernelVersion: KERNEL_VERSION,
  });

  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: ecdsaValidator },
    entryPoint: ENTRY_POINT as any,
    kernelVersion: KERNEL_VERSION,
  } as any);

  const paymasterClient = createZeroDevPaymasterClient({
    chain,
    transport: http(paymasterUrl),
  } as any);

  const kernelClient = createKernelAccountClient({
    account: kernelAccount,
    chain,
    bundlerTransport: http(bundlerUrl),
    middleware: {
      sponsorUserOperation: async ({
        userOperation,
      }: {
        userOperation: any;
      }) => {
        return (paymasterClient as any).sponsorUserOperation({
          userOperation,
          entryPoint: ENTRY_POINT_ADDRESS,
        });
      },
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

/**
 * Deploy a ZeroDev Kernel smart account and install the ERC-7579 AutopayModule.
 *
 * Flow:
 *   1. Create an ECDSA validator from the user's signer
 *   2. Create a Kernel account (counterfactual address if not yet deployed)
 *   3. Create a Kernel account client with ZeroDev paymaster for gas sponsorship
 *   4. Install the AutopayModule as an execution module on the Kernel
 *
 * PRD ARCENPAY-001 — This enables recurring subscription payments to be
 * pulled automatically by the BillingKeeper.
 */
export async function deploySmartAccount(
  config: DeploySmartAccountConfig,
): Promise<SmartAccountResult> {
  const chain = CHAIN_MAP[config.chainId] || baseSepolia;
  const contracts = getContractAddresses(config.chainId);

  const { bundlerUrl, paymasterUrl, hasConfiguredUrls } = resolveZeroDevUrls({
    projectId: config.projectId,
    chainId: config.chainId,
    bundlerUrl: config.bundlerUrl,
    paymasterUrl: config.paymasterUrl,
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  }) as PublicClient;

  // Step 1: Create ECDSA validator from user's wallet
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: config.walletClient as any,
    entryPoint: ENTRY_POINT as any,
    kernelVersion: KERNEL_VERSION,
  });

  // Step 2: Create Kernel account
  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: {
      sudo: ecdsaValidator,
    },
    entryPoint: ENTRY_POINT as any,
    kernelVersion: KERNEL_VERSION,
  } as any);

  const smartAccountAddress = kernelAccount.address;

  // Check if already deployed
  const code = await publicClient.getCode({ address: smartAccountAddress });
  const alreadyDeployed = !!code && code !== "0x";

  // Step 3: Create Kernel account client with paymaster
  const paymasterClient = createZeroDevPaymasterClient({
    chain,
    transport: http(paymasterUrl),
  } as any);

  return {
    smartAccountAddress,
    installTxHash: undefined,
    alreadyDeployed,
  };
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
    throw new Error("Automatic payment system address is not configured for this chain.");
  }

  const { bundlerUrl, paymasterUrl, hasConfiguredUrls } = resolveZeroDevUrls({
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
    throw normalizeZeroDevError(error, {
      projectId: config.projectId,
      chainId: config.chainId,
      bundlerUrl,
      paymasterUrl,
      hasConfiguredUrls,
    });
  }
}

/**
 * Sends a transaction through the caller's ZeroDev Kernel smart account and waits
 * for the resulting on-chain receipt. This keeps follow-up checkout actions
 * originating from the smart account rather than the owner EOA.
 */
export async function sendSmartAccountTransaction(
  config: SmartAccountTransactionConfig,
): Promise<{
  smartAccountAddress: `0x${string}`;
  txHash: `0x${string}`;
}> {
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
    throw normalizeZeroDevError(error, {
      projectId: config.projectId,
      chainId: config.chainId,
      bundlerUrl,
      paymasterUrl,
      hasConfiguredUrls,
    });
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
    throw new Error("Automatic payment system address is not configured for this chain.");
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
