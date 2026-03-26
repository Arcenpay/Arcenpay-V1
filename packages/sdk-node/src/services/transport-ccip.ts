// ============================================================
//  @arcenpay/node — Chainlink CCIP Transport Adapter
//  Fallback cross-chain message transport via Chainlink CCIP
//  PRD §7.2 — Cross-Chain Transport Layer (Fallback)
// ============================================================

import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, baseSepolia, base } from "viem/chains";

const CHAIN_MAP: Record<number, any> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
};

// CCIP chain selector mapping (Chainlink uses uint64 selectors)
const CCIP_CHAIN_SELECTORS: Record<number, bigint> = {
  1: 5009297550715157269n, // Ethereum Mainnet
  11155111: 16015286601757825753n, // Sepolia
  137: 4051577828743386545n, // Polygon
  42161: 4949039107694359620n, // Arbitrum
  10: 3734403246176062136n, // Optimism
  8453: 15971525489660198786n, // Base
  84532: 10344971235874465080n, // Base Sepolia
  43114: 6433500567565415381n, // Avalanche
};

export interface CCIPTransportConfig {
  /** CCIP Router contract address on source chain */
  routerAddress: `0x${string}`;
  /** RPC URL for source chain */
  rpcUrl: string;
  /** Private key for signing dispatch transactions */
  privateKey: `0x${string}`;
  /** Source chain ID */
  chainId?: number;
  /** MirrorRegistry address on destination chain */
  mirrorRegistryAddress: `0x${string}`;
  /** LINK token address for fee payment (if using LINK) */
  linkTokenAddress?: `0x${string}`;
  /** Gas limit for destination execution */
  gasLimit?: bigint;
}

// Minimal CCIP Router ABI
const CCIP_ROUTER_ABI = [
  {
    name: "ccipSend",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "destinationChainSelector", type: "uint64" },
      {
        name: "message",
        type: "tuple",
        components: [
          { name: "receiver", type: "bytes" },
          { name: "data", type: "bytes" },
          {
            name: "tokenAmounts",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "feeToken", type: "address" },
          { name: "extraArgs", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "messageId", type: "bytes32" }],
  },
  {
    name: "getFee",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "destinationChainSelector", type: "uint64" },
      {
        name: "message",
        type: "tuple",
        components: [
          { name: "receiver", type: "bytes" },
          { name: "data", type: "bytes" },
          {
            name: "tokenAmounts",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "feeToken", type: "address" },
          { name: "extraArgs", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "fee", type: "uint256" }],
  },
] as const;

export interface CCIPDispatchResult {
  transactionHash: `0x${string}`;
  messageId: string;
  route: "ccip";
  destinationChainSelector: bigint;
  fee: bigint;
}

/**
 * CCIPTransport — Fallback cross-chain transport via Chainlink CCIP.
 *
 * Used when Axelar dispatch fails. Sends CCIP messages with:
 * - EVM2AnyMessage encoding
 * - Native gas fee payment (ETH)
 * - Configurable destination gas limit
 */
export class CCIPTransport {
  private readonly config: CCIPTransportConfig;
  private readonly chainId: number;
  private readonly publicClient: any;
  private readonly walletClient: any;
  private readonly signerAddress: `0x${string}`;
  private readonly gasLimit: bigint;

  constructor(config: CCIPTransportConfig) {
    this.config = config;
    this.chainId = config.chainId || 11155111;
    this.gasLimit = config.gasLimit || 200_000n;

    const chain = CHAIN_MAP[this.chainId] || sepolia;
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
   * Dispatch a cross-chain mirror update via Chainlink CCIP
   */
  async dispatch(
    destinationChainId: number,
    payload: `0x${string}`,
    refundAddress: `0x${string}`,
  ): Promise<CCIPDispatchResult> {
    const destSelector = CCIP_CHAIN_SELECTORS[destinationChainId];
    if (!destSelector) {
      throw new Error(
        `Unsupported CCIP destination chain ID: ${destinationChainId}`,
      );
    }

    const message = this.buildMessage(payload);

    // Step 1: Estimate fee
    let fee = 0n;
    try {
      fee = (await this.publicClient.readContract({
        address: this.config.routerAddress,
        abi: CCIP_ROUTER_ABI,
        functionName: "getFee",
        args: [destSelector, message],
      })) as bigint;
    } catch {
      // Fee estimation failed — use fallback (0.005 ETH)
      fee = 5_000_000_000_000_000n;
    }

    // Add 15% buffer
    const feeBudget = (fee * 115n) / 100n;

    // Step 2: Send via CCIP Router
    const txHash = await this.walletClient.writeContract({
      address: this.config.routerAddress,
      abi: CCIP_ROUTER_ABI,
      functionName: "ccipSend",
      args: [destSelector, message],
      value: feeBudget,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    console.log(
      `[CCIPTransport] ✅ Dispatched to selector ${destSelector} → tx: ${txHash}`,
    );

    return {
      transactionHash: txHash,
      messageId: `ccip-${txHash}`,
      route: "ccip",
      destinationChainSelector: destSelector,
      fee: feeBudget,
    };
  }

  /**
   * Build a CCIP EVM2AnyMessage
   */
  private buildMessage(payload: `0x${string}`): {
    receiver: `0x${string}`;
    data: `0x${string}`;
    tokenAmounts: readonly [];
    feeToken: `0x${string}`;
    extraArgs: `0x${string}`;
  } {
    // Encode extraArgs with gas limit (EVMExtraArgsV1 tag = 0x97a657c9)
    const extraArgs =
      `0x97a657c9${this.gasLimit.toString(16).padStart(64, "0")}` as `0x${string}`;

    return {
      receiver: this.config.mirrorRegistryAddress,
      data: payload,
      tokenAmounts: [] as const,
      feeToken: "0x0000000000000000000000000000000000000000" as `0x${string}`, // Native gas
      extraArgs,
    };
  }

  /**
   * Estimate the CCIP fee for a dispatch
   */
  async estimateFee(
    destinationChainId: number,
    payload: `0x${string}`,
  ): Promise<bigint> {
    const destSelector = CCIP_CHAIN_SELECTORS[destinationChainId];
    if (!destSelector) return 0n;

    try {
      return (await this.publicClient.readContract({
        address: this.config.routerAddress,
        abi: CCIP_ROUTER_ABI,
        functionName: "getFee",
        args: [destSelector, this.buildMessage(payload)],
      })) as bigint;
    } catch {
      return 5_000_000_000_000_000n; // 0.005 ETH fallback
    }
  }

  /**
   * Get signer's gas balance (for alert monitoring)
   */
  async getSignerBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.signerAddress });
  }
}
