// ============================================================
//  @arcenpay/node — Axelar GMP Transport Adapter
//  Primary cross-chain message transport via Axelar Network
//  PRD §7.2 — Cross-Chain Transport Layer
// ============================================================

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, baseSepolia, base } from "viem/chains";
import { DEFAULT_CHAIN_ID } from "../sdk";

const CHAIN_MAP: Record<number, any> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
};

// Axelar chain name mapping (Axelar uses string identifiers)
const AXELAR_CHAIN_NAMES: Record<number, string> = {
  1: "ethereum",
  11155111: "ethereum-sepolia",
  137: "polygon",
  42161: "arbitrum",
  10: "optimism",
  8453: "base",
  84532: "base-sepolia",
  43114: "avalanche",
};

export interface AxelarTransportConfig {
  /** Axelar Gateway contract address on source chain */
  gatewayAddress: `0x${string}`;
  /** Axelar Gas Service contract address for prepaying gas */
  gasServiceAddress: `0x${string}`;
  /** RPC URL for source chain */
  rpcUrl: string;
  /** Private key for signing dispatch transactions */
  privateKey: `0x${string}`;
  /** Source chain ID */
  chainId?: number;
  /** MirrorRegistry address on destination chain */
  mirrorRegistryAddress: `0x${string}`;
}

// Minimal ABIs for Axelar contracts
const AXELAR_GATEWAY_ABI = [
  {
    name: "callContract",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "destinationChain", type: "string" },
      { name: "contractAddress", type: "string" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const AXELAR_GAS_SERVICE_ABI = [
  {
    name: "payNativeGasForContractCall",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "sender", type: "address" },
      { name: "destinationChain", type: "string" },
      { name: "destinationAddress", type: "string" },
      { name: "payload", type: "bytes" },
      { name: "refundAddress", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "estimateGasFee",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "destinationChain", type: "string" },
      { name: "destinationAddress", type: "string" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface DispatchResult {
  transactionHash: `0x${string}`;
  messageId: string;
  route: "axelar";
  destinationChain: string;
  gasEstimate: bigint;
}

/**
 * AxelarTransport — Dispatches cross-chain GMP messages via Axelar Network.
 *
 * Flow:
 * 1. Encode mirror payload (subscriber, tokenId, planId, tier, expiration, timestamp)
 * 2. Estimate gas via Axelar Gas Service
 * 3. Pre-pay gas via payNativeGasForContractCall
 * 4. Call gateway.callContract() to dispatch to destination MirrorRegistry
 */
export class AxelarTransport {
  private readonly config: AxelarTransportConfig;
  private readonly chainId: number;
  private readonly publicClient: any;
  private readonly walletClient: any;
  private readonly signerAddress: `0x${string}`;

  constructor(config: AxelarTransportConfig) {
    this.config = config;
    this.chainId = config.chainId ?? DEFAULT_CHAIN_ID;

    const chain = CHAIN_MAP[this.chainId] || baseSepolia;
    const account = privateKeyToAccount(config.privateKey);
    this.signerAddress = account.address;

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as any;

    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrl),
    }) as any;
  }

  /**
   * Dispatch a cross-chain mirror update via Axelar GMP
   */
  async dispatch(
    destinationChainId: number,
    payload: `0x${string}`,
    refundAddress: `0x${string}`,
    destinationAddressOverride?: `0x${string}`,
  ): Promise<DispatchResult> {
    const destChainName = AXELAR_CHAIN_NAMES[destinationChainId];
    if (!destChainName) {
      throw new Error(
        `Unsupported destination chain ID: ${destinationChainId}`,
      );
    }

    const destAddress =
      destinationAddressOverride || this.config.mirrorRegistryAddress;

    // Step 1: Estimate gas
    let gasEstimate = 0n;
    try {
      gasEstimate = (await this.publicClient.readContract({
        address: this.config.gasServiceAddress,
        abi: AXELAR_GAS_SERVICE_ABI,
        functionName: "estimateGasFee",
        args: [destChainName, destAddress, payload],
      })) as bigint;
    } catch {
      // Estimation not available — use fallback (0.002 ETH)
      gasEstimate = 2_000_000_000_000_000n;
    }

    // Add 20% buffer
    const gasBudget = (gasEstimate * 120n) / 100n;

    // Step 2: Pre-pay gas
    const gasPayTx = await this.walletClient.writeContract({
      address: this.config.gasServiceAddress,
      abi: AXELAR_GAS_SERVICE_ABI,
      functionName: "payNativeGasForContractCall",
      args: [
        this.signerAddress,
        destChainName,
        destAddress,
        payload,
        refundAddress,
      ],
      value: gasBudget,
    });

    await this.publicClient.waitForTransactionReceipt({ hash: gasPayTx });

    // Step 3: Dispatch via Gateway
    const dispatchTx = await this.walletClient.writeContract({
      address: this.config.gatewayAddress,
      abi: AXELAR_GATEWAY_ABI,
      functionName: "callContract",
      args: [destChainName, destAddress, payload],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: dispatchTx,
    });

    console.log(
      `[AxelarTransport] ✅ Dispatched to ${destChainName} → tx: ${dispatchTx}`,
    );

    return {
      transactionHash: dispatchTx,
      messageId: `axelar-${dispatchTx}`,
      route: "axelar",
      destinationChain: destChainName,
      gasEstimate: gasBudget,
    };
  }

  /**
   * Get the estimated gas cost for a dispatch
   */
  async estimateGas(
    destinationChainId: number,
    payload: `0x${string}`,
    destinationAddressOverride?: `0x${string}`,
  ): Promise<bigint> {
    const destChainName = AXELAR_CHAIN_NAMES[destinationChainId];
    if (!destChainName) return 0n;
    const destAddress =
      destinationAddressOverride || this.config.mirrorRegistryAddress;

    try {
      return (await this.publicClient.readContract({
        address: this.config.gasServiceAddress,
        abi: AXELAR_GAS_SERVICE_ABI,
        functionName: "estimateGasFee",
        args: [destChainName, destAddress, payload],
      })) as bigint;
    } catch {
      return 2_000_000_000_000_000n; // 0.002 ETH fallback
    }
  }

  /**
   * Get signer's gas balance (for alert monitoring)
   */
  async getSignerBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.signerAddress });
  }
}
