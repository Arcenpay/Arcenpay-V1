// ============================================================
//  ArcenPay Internal Core — Smart Account Helpers (ERC-7579)
//  PRD §04 — ERC-7579 Smart Account Integration
//
//  Requires these packages to be installed in the consuming app:
//    npm install permissionless
// ============================================================

import { createPublicClient, http, type WalletClient } from "viem";
import { prepareUserOperation } from "viem/account-abstraction";
import { toKernelSmartAccount } from "permissionless/accounts";
import { createSmartAccountClient } from "permissionless/clients";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import {
  applyVerificationGasFloor,
  resolveSmartAccountKernelConfig,
} from "./smart-account-config";

export interface SmartAccountInput {
  /** The EOA owner address */
  ownerAddress: `0x${string}`;
  /** Chain ID to deploy on */
  chainId: number;
  /** Wallet client for signing UserOperations */
  walletClient: WalletClient;
}

export interface SmartAccountResult {
  /** The deployed (or pre-computed CREATE2) smart account address */
  accountAddress: `0x${string}`;
  /** Transaction hash of the deployment UserOperation */
  txHash?: `0x${string}`;
  /** Whether this was a new deployment */
  wasDeployed: boolean;
}

/**
 * Creates or retrieves an ERC-7579 Kernel smart account for the given owner.
 *
 * Uses CREATE2 for deterministic addresses — calling multiple times for the same
 * owner returns the same address without re-deploying.
 * Sponsors gas for first-time deployment via the configured paymaster provider.
 *
 * @example
 * ```ts
 * const result = await createSmartAccount({
 *   ownerAddress: '0xabc...',
 *   chainId: 84532,
 *   walletClient,
 * });
 * ```
 */
export async function createSmartAccount(
  input: SmartAccountInput,
): Promise<SmartAccountResult> {
  const { chainId, walletClient } = input;
  const kernelConfig = resolveSmartAccountKernelConfig(chainId);
  const entryPoint = {
    address: kernelConfig.entryPointAddress,
    version: kernelConfig.entryPointVersion,
  } as const;
  const specificPimlicoRpc = process.env[`NEXT_PUBLIC_PIMLICO_RPC_${chainId}`];
  const genericPimlicoRpc = process.env.NEXT_PUBLIC_PIMLICO_RPC;
  const specificPimlicoApiKey =
    process.env[`NEXT_PUBLIC_PIMLICO_API_KEY_${chainId}`];
  const genericPimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
  const defaultPimlicoV2 =
    specificPimlicoApiKey || genericPimlicoApiKey
      ? `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${
          specificPimlicoApiKey || genericPimlicoApiKey
        }`
      : "";

  if (!specificPimlicoRpc && !genericPimlicoRpc && !defaultPimlicoV2) {
    throw new Error(
      "[createSmartAccount] A smart-account provider is required. " +
        "Set NEXT_PUBLIC_PIMLICO_RPC or NEXT_PUBLIC_PIMLICO_API_KEY in your environment.",
    );
  }
  const bundlerRpc =
    specificPimlicoRpc ||
    genericPimlicoRpc ||
    defaultPimlicoV2;
  const paymasterRpc =
    specificPimlicoRpc ||
    genericPimlicoRpc ||
    defaultPimlicoV2;

  // Resolve chain config
  const { getChain } = await import("./chains");
  const chain = getChain(chainId);

  const publicClient = createPublicClient({ chain, transport: http() });
  const account = await toKernelSmartAccount({
    client: publicClient,
    owners: [walletClient as any],
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

  // Check if account is already deployed
  const existingCode = await publicClient.getCode({ address: account.address });
  const isAlreadyDeployed = !!existingCode && existingCode.length > 2;

  if (isAlreadyDeployed) {
    return { accountAddress: account.address, wasDeployed: false };
  }

  const pimlicoClient = createPimlicoClient({
    chain,
    transport: http(paymasterRpc),
    entryPoint: entryPoint as any,
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain,
    client: publicClient,
    bundlerTransport: http(bundlerRpc),
    paymaster: {
      getPaymasterStubData: async (userOperation) => {
        const {
          chainId: _ignoredChainId,
          entryPointAddress: _ignoredEntryPointAddress,
          ...paymasterRequest
        } = userOperation as Record<string, unknown>;
        const sponsorship = await pimlicoClient.getPaymasterStubData({
          chainId,
          entryPointAddress: entryPoint.address,
          ...(paymasterRequest as any),
        } as any);

        return {
          ...sponsorship,
          isFinal:
            "isFinal" in sponsorship ? Boolean((sponsorship as any).isFinal) : false,
        };
      },
      getPaymasterData: async (userOperation) => {
        const {
          chainId: _ignoredChainId,
          entryPointAddress: _ignoredEntryPointAddress,
          ...paymasterRequest
        } = userOperation as Record<string, unknown>;

        return pimlicoClient.getPaymasterData({
          chainId,
          entryPointAddress: entryPoint.address,
          ...(paymasterRequest as any),
        } as any);
      },
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
  });

  // Deploy by sending a no-op self-call UserOperation
  const txHash = await smartAccountClient.sendTransaction({
    to: account.address,
    value: 0n,
    data: "0x",
  });

  return {
    accountAddress: account.address,
    txHash: txHash as `0x${string}`,
    wasDeployed: true,
  };
}
