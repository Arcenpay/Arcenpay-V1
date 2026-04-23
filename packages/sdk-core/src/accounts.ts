// ============================================================
//  @arcenpay/sdk — Smart Account Helpers (ZeroDev / ERC-7579)
//  PRD §04 — ERC-7579 Smart Account Integration
//
//  Requires these packages to be installed in the consuming app:
//    npm install @zerodev/sdk @zerodev/ecdsa-validator permissionless
// ============================================================

import { createPublicClient, http, type WalletClient } from 'viem';

export interface SmartAccountInput {
    /** The EOA owner address */
    ownerAddress: `0x${string}`;
    /** Chain ID to deploy on */
    chainId: number;
    /** ZeroDev project ID from NEXT_PUBLIC_ZERODEV_PROJECT_ID */
    zeroDevProjectId: string;
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
 * Creates or retrieves a ZeroDev ERC-7579 Kernel smart account for the given owner.
 *
 * Uses CREATE2 for deterministic addresses — calling multiple times for the same
 * owner returns the same address without re-deploying.
 * Sponsors gas for first-time deployment via ZeroDev paymaster (PRD §4.3).
 *
 * @example
 * ```ts
 * const result = await createSmartAccount({
 *   ownerAddress: '0xabc...',
 *   chainId: 84532,
 *   zeroDevProjectId: process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID!,
 *   walletClient,
 * });
 * ```
 */
export async function createSmartAccount(
    input: SmartAccountInput,
): Promise<SmartAccountResult> {
    const { chainId, zeroDevProjectId, walletClient } = input;

    if (!zeroDevProjectId) {
        throw new Error(
            '[createSmartAccount] zeroDevProjectId is required. ' +
            'Set NEXT_PUBLIC_ZERODEV_PROJECT_ID in your environment.',
        );
    }

    const specificUnified =
        process.env[`NEXT_PUBLIC_ZERODEV_RPC_${chainId}`];
    const specificBundler =
        process.env[`NEXT_PUBLIC_ZERODEV_BUNDLER_RPC_${chainId}`];
    const specificPaymaster =
        process.env[`NEXT_PUBLIC_ZERODEV_PAYMASTER_RPC_${chainId}`];
    const genericUnified = process.env.NEXT_PUBLIC_ZERODEV_RPC;
    const genericBundler = process.env.NEXT_PUBLIC_ZERODEV_BUNDLER_RPC;
    const genericPaymaster = process.env.NEXT_PUBLIC_ZERODEV_PAYMASTER_RPC;
    const defaultUnifiedV3 =
        `https://rpc.zerodev.app/api/v3/${zeroDevProjectId}/chain/${chainId}`;
    const bundlerRpc =
        specificUnified ||
        specificBundler ||
        genericUnified ||
        genericBundler ||
        defaultUnifiedV3 ||
        `https://rpc.zerodev.app/api/v2/bundler/${zeroDevProjectId}`;
    const paymasterRpc =
        specificUnified ||
        specificPaymaster ||
        genericUnified ||
        genericPaymaster ||
        defaultUnifiedV3 ||
        `https://rpc.zerodev.app/api/v2/paymaster/${zeroDevProjectId}`;

    // Dynamically import ZeroDev to avoid SSR issues + keep tree-shakable
    let zdSdk: any;
    let zdEcdsa: any;

    try {
        [zdSdk, zdEcdsa] = await Promise.all([
            import('@zerodev/sdk'),
            import('@zerodev/ecdsa-validator'),
        ]);
    } catch {
        throw new Error(
            '[createSmartAccount] ZeroDev SDK is not installed. ' +
            'Run: npm install @zerodev/sdk @zerodev/ecdsa-validator permissionless',
        );
    }

    // Resolve kernel constants — KERNEL_V3_1 and getEntryPoint live under constants
    const zdConstants = zdSdk.constants ?? zdSdk;
    const KERNEL_V3_1 = zdConstants.KERNEL_V3_1;
    const getEntryPoint =
        zdConstants.getEntryPoint ?? (zdSdk as any).getEntryPoint;

    if (!KERNEL_V3_1 || !getEntryPoint) {
        throw new Error(
            '[createSmartAccount] KERNEL_V3_1 / getEntryPoint not found. ' +
            'Ensure @zerodev/sdk >= 5.0 is installed.',
        );
    }

    const entryPoint = getEntryPoint('0.7');

    const {
        createKernelAccount,
        createKernelAccountClient,
        createZeroDevPaymasterClient,
    } = zdSdk;

    const { signerToEcdsaValidator } = zdEcdsa;

    // Resolve chain config
    const { getChain } = await import('./chains');
    const chain = getChain(chainId);

    const publicClient = createPublicClient({ chain, transport: http() });

    // ECDSA validator wraps the walletClient as the Kernel sudo owner
    const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
        signer: walletClient as any,
        entryPoint,
        kernelVersion: KERNEL_V3_1,
    });

    // Create Kernel account — deterministic CREATE2 address
    const account = await createKernelAccount(publicClient, {
        plugins: { sudo: ecdsaValidator },
        entryPoint,
        kernelVersion: KERNEL_V3_1,
    });

    // Check if account is already deployed
    const existingCode = await publicClient.getCode({ address: account.address });
    const isAlreadyDeployed = !!existingCode && existingCode.length > 2;

    if (isAlreadyDeployed) {
        return { accountAddress: account.address, wasDeployed: false };
    }

    // Paymaster for gas-sponsored deployment (PRD §4.3)
    const paymasterClient = createZeroDevPaymasterClient({
        chain,
        transport: http(paymasterRpc),
    });

    const kernelClient = createKernelAccountClient({
        account,
        chain,
        bundlerTransport: http(bundlerRpc),
        paymaster: paymasterClient,
    });

    // Deploy by sending a no-op self-call UserOperation
    const txHash = await kernelClient.sendUserOperation({
        callData: await account.encodeCalls([
            { to: account.address, value: 0n, data: '0x' },
        ]),
    });

    return {
        accountAddress: account.address,
        txHash: txHash as `0x${string}`,
        wasDeployed: true,
    };
}
