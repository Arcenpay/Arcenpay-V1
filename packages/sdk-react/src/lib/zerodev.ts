// ============================================================
//  @meap/react — ZeroDev Smart Account Integration
//  ERC-7579 Kernel account provisioning with AutopayModule
//  PRD MEAP-001 — Smart Account Provisioning
// ============================================================

import {
    createKernelAccount,
    createKernelAccountClient,
    createZeroDevPaymasterClient,
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
} from "@meap/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CHAIN_MAP: Record<number, any> = {
    11155111: sepolia,
    84532: baseSepolia,
    8453: base,
};

const ENTRY_POINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const; // ERC-4337 v0.7

export interface DeploySmartAccountConfig {
    /** ZeroDev project ID (from dashboard.zerodev.app) */
    projectId: string;
    /** Chain ID */
    chainId: number;
    /** The user's wallet client (e.g., from wagmi) */
    walletClient: WalletClient;
    /** Optional: bundler URL override */
    bundlerUrl?: string;
    /** Optional: paymaster URL override */
    paymasterUrl?: string;
}

export interface SmartAccountResult {
    /** The Kernel smart account address */
    smartAccountAddress: `0x${string}`;
    /** Transaction hash of the module installation */
    installTxHash?: `0x${string}`;
    /** Whether the account was already deployed */
    alreadyDeployed: boolean;
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
 * PRD MEAP-001 — This enables recurring subscription payments to be
 * pulled automatically by the BillingKeeper.
 */
export async function deploySmartAccount(
    config: DeploySmartAccountConfig,
): Promise<SmartAccountResult> {
    const chain = CHAIN_MAP[config.chainId] || baseSepolia;
    const contracts = getContractAddresses(config.chainId);

    // ZeroDev URLs
    const bundlerUrl =
        config.bundlerUrl ||
        `https://rpc.zerodev.app/api/v2/bundler/${config.projectId}`;
    const paymasterUrl =
        config.paymasterUrl ||
        `https://rpc.zerodev.app/api/v2/paymaster/${config.projectId}`;

    const publicClient = createPublicClient({
        chain,
        transport: http(),
    }) as PublicClient;

    // Step 1: Create ECDSA validator from user's wallet
    const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
        signer: config.walletClient as any,
        entryPoint: ENTRY_POINT_ADDRESS as any,
        kernelVersion: "0.3.1",
    });

    // Step 2: Create Kernel account
    const kernelAccount = await createKernelAccount(publicClient, {
        plugins: {
            sudo: ecdsaValidator,
        },
        entryPoint: ENTRY_POINT_ADDRESS as any,
    } as any);

    const smartAccountAddress = kernelAccount.address;

    // Check if already deployed
    const code = await publicClient.getCode({ address: smartAccountAddress });
    const alreadyDeployed = !!code && code !== "0x";

    // Step 3: Create Kernel account client with paymaster
    const paymasterClient = createZeroDevPaymasterClient({
        chain,
        transport: http(paymasterUrl),
        entryPoint: ENTRY_POINT_ADDRESS as any,
    } as any);

    const kernelClient = createKernelAccountClient({
        account: kernelAccount,
        chain,
        bundlerTransport: http(bundlerUrl),
        middleware: {
            sponsorUserOperation: async ({ userOperation }: { userOperation: any }) => {
                return (paymasterClient as any).sponsorUserOperation({
                    userOperation,
                    entryPoint: ENTRY_POINT_ADDRESS,
                });
            },
        },
    } as any);

    // Step 4: Install AutopayModule if not already installed
    let installTxHash: `0x${string}` | undefined;

    if (contracts.autopayModule) {
        try {
            // Encode the module installation call
            // ERC-7579 defines installModule(uint256 moduleType, address module, bytes initData)
            const installData = encodeFunctionData({
                abi: [
                    {
                        type: "function",
                        name: "installModule",
                        inputs: [
                            { name: "moduleType", type: "uint256" },
                            { name: "module", type: "address" },
                            { name: "initData", type: "bytes" },
                        ],
                        outputs: [],
                        stateMutability: "nonpayable",
                    },
                ],
                functionName: "installModule",
                args: [
                    2n, // Module type 2 = Executor
                    contracts.autopayModule as `0x${string}`,
                    "0x" as `0x${string}`, // Empty init data
                ],
            });

            installTxHash = await (kernelClient as any).sendTransaction({
                to: smartAccountAddress,
                data: installData,
                value: 0n,
            });

            console.log(
                `[ZeroDev] AutopayModule installed on ${smartAccountAddress} — tx: ${installTxHash}`,
            );
        } catch (err: any) {
            // Module might already be installed
            if (
                err?.message?.includes("already installed") ||
                err?.message?.includes("AlreadyInitialized")
            ) {
                console.log(
                    `[ZeroDev] AutopayModule already installed on ${smartAccountAddress}`,
                );
            } else {
                console.error("[ZeroDev] Module installation failed:", err?.message);
                throw err;
            }
        }
    }

    return {
        smartAccountAddress,
        installTxHash,
        alreadyDeployed,
    };
}
