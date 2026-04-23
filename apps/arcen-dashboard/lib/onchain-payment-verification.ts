import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  http,
  isAddress,
  type Chain,
} from "viem";
import { base, baseSepolia, sepolia } from "viem/chains";
import {
  ERC7579AutopayModuleABI,
  getContractAddresses,
  PlanFactoryABI,
  SubscriptionRegistryABI,
} from "@arcenpay/sdk";
import { getRpcUrl } from "@/lib/config";

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
};

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface VerifyDirectErc20TransferInput {
  acceptedToken: string;
  txHash: `0x${string}`;
  expectedAmountAtomic: bigint;
  recipientWallet: string;
  senderWallet?: string | null;
}

export type VerifyDirectErc20TransferResult =
  | {
      ok: true;
      txHash: `0x${string}`;
      senderWallet: string;
      recipientWallet: string;
      amountAtomic: bigint;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export function normalizeTxHash(value?: string | null): `0x${string}` | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  return trimmed as `0x${string}`;
}

export function decimalToAtomicUnits(value: string, decimals = 6): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const paddedFraction = `${fraction}${"0".repeat(decimals)}`.slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0");
}

function resolveChain(): Chain {
  const chainId = Number(
    process.env.MEAP_DEFAULT_CHAIN_ID ||
      process.env.CHAIN_ID ||
      process.env.NEXT_PUBLIC_CHAIN_ID ||
      "11155111",
  );
  return CHAIN_MAP[chainId] ?? sepolia;
}

function createChainPublicClient() {
  const chain = resolveChain();
  return {
    chain,
    contracts: getContractAddresses(chain.id),
    publicClient: createPublicClient({
      chain,
      transport: http(getRpcUrl(chain.id)),
    }),
  };
}

export async function verifyDirectErc20Transfer(
  params: VerifyDirectErc20TransferInput,
): Promise<VerifyDirectErc20TransferResult> {
  if (!isAddress(params.acceptedToken)) {
    return {
      ok: false,
      status: 409,
      error: "Accepted token contract is not configured correctly.",
    };
  }
  if (!isAddress(params.recipientWallet)) {
    return {
      ok: false,
      status: 409,
      error: "Recipient wallet is not configured correctly.",
    };
  }
  if (params.senderWallet && !isAddress(params.senderWallet)) {
    return {
      ok: false,
      status: 409,
      error: "Sender wallet is not configured correctly.",
    };
  }

  const { publicClient } = createChainPublicClient();

  try {
    const [transaction, receipt] = await Promise.all([
      publicClient.getTransaction({ hash: params.txHash }),
      publicClient.getTransactionReceipt({ hash: params.txHash }),
    ]);

    if (receipt.status !== "success") {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction did not complete successfully.",
      };
    }

    if (
      !transaction.to ||
      transaction.to.toLowerCase() !== params.acceptedToken.toLowerCase()
    ) {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction was sent to the wrong token contract.",
      };
    }

    if (
      params.senderWallet &&
      transaction.from.toLowerCase() !== params.senderWallet.toLowerCase()
    ) {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction was sent from the wrong wallet.",
      };
    }

    const decoded = decodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      data: transaction.input,
    });

    if (decoded.functionName !== "transfer") {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction must be a direct ERC-20 transfer.",
      };
    }

    const [recipient, amount] = decoded.args as [`0x${string}`, bigint];
    if (recipient.toLowerCase() !== params.recipientWallet.toLowerCase()) {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction was sent to the wrong recipient wallet.",
      };
    }

    if (amount !== params.expectedAmountAtomic) {
      return {
        ok: false,
        status: 409,
        error: "Payment transaction amount does not match the approved total.",
      };
    }

    return {
      ok: true,
      txHash: params.txHash,
      senderWallet: transaction.from.toLowerCase(),
      recipientWallet: recipient.toLowerCase(),
      amountAtomic: amount,
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error:
        error instanceof Error
          ? error.message
          : "Could not verify payment transaction.",
    };
  }
}

export interface VerifyAutopayPlanChangeInput {
  paymentAccount: string;
  txHash: `0x${string}`;
  expectedOnChainPlanId: string;
}

export type VerifyAutopayPlanChangeResult =
  | {
      ok: true;
      txHash: `0x${string}`;
      tokenId: string;
      previousOnChainPlanId: string;
      onChainPlanId: string;
      acceptedToken: string;
      merchantWallet: string;
      currentPeriodEnd: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export async function verifyAutopayPlanChange(
  params: VerifyAutopayPlanChangeInput,
): Promise<VerifyAutopayPlanChangeResult> {
  if (!isAddress(params.paymentAccount)) {
    return {
      ok: false,
      status: 409,
      error: "Payment account is not configured correctly.",
    };
  }

  const expectedOnChainPlanId = BigInt(params.expectedOnChainPlanId);
  const { publicClient, contracts } = createChainPublicClient();
  const autopayAddress = contracts.autopayModule as `0x${string}`;
  const subscriptionRegistryAddress =
    contracts.subscriptionRegistry as `0x${string}`;
  const planFactoryAddress = contracts.planFactory as `0x${string}`;

  if (
    !autopayAddress ||
    !subscriptionRegistryAddress ||
    !planFactoryAddress ||
    !isAddress(autopayAddress) ||
    !isAddress(subscriptionRegistryAddress) ||
    !isAddress(planFactoryAddress)
  ) {
    return {
      ok: false,
      status: 503,
      error: "Subscription contracts are not configured for this chain.",
    };
  }

  try {
    const [receipt, targetPlan] = await Promise.all([
      publicClient.getTransactionReceipt({ hash: params.txHash }),
      publicClient.readContract({
        address: planFactoryAddress,
        abi: PlanFactoryABI,
        functionName: "getPlan",
        args: [expectedOnChainPlanId],
      }) as Promise<{
        provider?: string;
        price?: bigint;
        billingInterval?: number;
        acceptedToken?: string;
        active?: boolean;
      }>,
    ]);

    if (receipt.status !== "success") {
      return {
        ok: false,
        status: 409,
        error: "Plan change transaction did not complete successfully.",
      };
    }

    if (!targetPlan?.active) {
      return {
        ok: false,
        status: 409,
        error: "The destination on-chain plan is inactive.",
      };
    }

    let configUpdatedEvent:
      | {
          previousPlanId: bigint;
          newPlanId: bigint;
          maxAmount: bigint;
          interval: number;
        }
      | null = null;
    let planChangedEvent:
      | {
          tokenId: bigint;
          previousPlanId: bigint;
          newPlanId: bigint;
          expiration: bigint;
        }
      | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === autopayAddress.toLowerCase()) {
        try {
          const decoded = decodeEventLog({
            abi: ERC7579AutopayModuleABI as any,
            data: log.data,
            topics: log.topics,
          }) as { eventName: string; args: Record<string, unknown> };
          if (decoded.eventName === "AutopayConfigUpdated") {
            const args = decoded.args as unknown as {
              account: string;
              previousPlanId: bigint;
              newPlanId: bigint;
              maxAmount: bigint;
              interval: number;
            };
            if (
              args.account.toLowerCase() === params.paymentAccount.toLowerCase()
            ) {
              configUpdatedEvent = {
                previousPlanId: args.previousPlanId,
                newPlanId: args.newPlanId,
                maxAmount: args.maxAmount,
                interval: args.interval,
              };
            }
          }
        } catch {
          // Ignore unrelated logs on the same contract.
        }
      }

      if (log.address.toLowerCase() === subscriptionRegistryAddress.toLowerCase()) {
        try {
          const decoded = decodeEventLog({
            abi: SubscriptionRegistryABI as any,
            data: log.data,
            topics: log.topics,
          }) as { eventName: string; args: Record<string, unknown> };
          if (decoded.eventName === "SubscriptionPlanChanged") {
            const args = decoded.args as unknown as {
              tokenId: bigint;
              previousPlanId: bigint;
              newPlanId: bigint;
              expiration: bigint;
            };
            planChangedEvent = args;
          }
        } catch {
          // Ignore unrelated logs on the same contract.
        }
      }
    }

    if (!configUpdatedEvent) {
      return {
        ok: false,
        status: 409,
        error:
          "Transaction did not emit AutopayConfigUpdated for the current payment account.",
      };
    }

    if (configUpdatedEvent.newPlanId !== expectedOnChainPlanId) {
      return {
        ok: false,
        status: 409,
        error: "Autopay config update targeted the wrong on-chain plan.",
      };
    }

    if (configUpdatedEvent.maxAmount !== BigInt(targetPlan.price ?? 0n)) {
      return {
        ok: false,
        status: 409,
        error: "Autopay config update used the wrong billing amount.",
      };
    }

    if (Number(configUpdatedEvent.interval) !== Number(targetPlan.billingInterval ?? 0)) {
      return {
        ok: false,
        status: 409,
        error: "Autopay config update used the wrong billing interval.",
      };
    }

    if (!planChangedEvent) {
      return {
        ok: false,
        status: 409,
        error:
          "Transaction did not emit SubscriptionPlanChanged. The subscription token was not updated.",
      };
    }

    if (planChangedEvent.newPlanId !== expectedOnChainPlanId) {
      return {
        ok: false,
        status: 409,
        error: "Subscription token was moved to the wrong on-chain plan.",
      };
    }

    const [updatedConfig, tokenId] = await Promise.all([
      publicClient.readContract({
        address: autopayAddress,
        abi: ERC7579AutopayModuleABI,
        functionName: "getConfig",
        args: [params.paymentAccount as `0x${string}`],
      }) as Promise<{
        merchant?: string;
        maxAmount?: bigint;
        token?: string;
        interval?: number;
        planId?: bigint;
      }>,
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "getWalletSubscription",
        args: [params.paymentAccount as `0x${string}`],
      }) as Promise<bigint>,
    ]);

    if (tokenId <= 0n) {
      return {
        ok: false,
        status: 409,
        error: "Payment account does not have an active subscription token after the plan change.",
      };
    }

    if (BigInt(updatedConfig?.planId ?? 0n) !== expectedOnChainPlanId) {
      return {
        ok: false,
        status: 409,
        error: "Autopay config is still out of sync after the plan change transaction.",
      };
    }

    if (
      String(updatedConfig?.merchant ?? "").toLowerCase() !==
      String(targetPlan.provider ?? "").toLowerCase()
    ) {
      return {
        ok: false,
        status: 409,
        error: "Autopay merchant is out of sync after the plan change transaction.",
      };
    }

    if (
      String(updatedConfig?.token ?? "").toLowerCase() !==
      String(targetPlan.acceptedToken ?? "").toLowerCase()
    ) {
      return {
        ok: false,
        status: 409,
        error: "Autopay accepted token is out of sync after the plan change transaction.",
      };
    }

    if (BigInt(updatedConfig?.maxAmount ?? 0n) !== BigInt(targetPlan.price ?? 0n)) {
      return {
        ok: false,
        status: 409,
        error: "Autopay max amount is out of sync after the plan change transaction.",
      };
    }

    if (Number(updatedConfig?.interval ?? 0) !== Number(targetPlan.billingInterval ?? 0)) {
      return {
        ok: false,
        status: 409,
        error: "Autopay interval is out of sync after the plan change transaction.",
      };
    }

    const [tokenFeatures, currentPeriodEnd] = await Promise.all([
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "getPlanFeatures",
        args: [tokenId],
      }) as Promise<{ planId?: bigint }>,
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "expiresAt",
        args: [tokenId],
      }) as Promise<bigint>,
    ]);

    if (BigInt(tokenFeatures?.planId ?? 0n) !== expectedOnChainPlanId) {
      return {
        ok: false,
        status: 409,
        error: "Subscription token still points at the wrong plan after the change transaction.",
      };
    }

    return {
      ok: true,
      txHash: params.txHash,
      tokenId: tokenId.toString(),
      previousOnChainPlanId: configUpdatedEvent.previousPlanId.toString(),
      onChainPlanId: expectedOnChainPlanId.toString(),
      acceptedToken: String(targetPlan.acceptedToken).toLowerCase(),
      merchantWallet: String(targetPlan.provider).toLowerCase(),
      currentPeriodEnd: new Date(Number(currentPeriodEnd) * 1000).toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error:
        error instanceof Error
          ? error.message
          : "Could not verify the on-chain plan change transaction.",
    };
  }
}

export interface VerifySubscriptionCancellationInput {
  paymentAccount: string;
  txHash: `0x${string}`;
}

export type VerifySubscriptionCancellationResult =
  | {
      ok: true;
      txHash: `0x${string}`;
      tokenId: string;
      onChainPlanId: string;
      cancelledAt: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export async function verifySubscriptionCancellation(
  params: VerifySubscriptionCancellationInput,
): Promise<VerifySubscriptionCancellationResult> {
  if (!isAddress(params.paymentAccount)) {
    return {
      ok: false,
      status: 409,
      error: "Payment account is not configured correctly.",
    };
  }

  const { publicClient, contracts } = createChainPublicClient();
  const subscriptionRegistryAddress =
    contracts.subscriptionRegistry as `0x${string}`;

  if (!subscriptionRegistryAddress || !isAddress(subscriptionRegistryAddress)) {
    return {
      ok: false,
      status: 503,
      error: "Subscription registry is not configured for this chain.",
    };
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: params.txHash,
    });

    if (receipt.status !== "success") {
      return {
        ok: false,
        status: 409,
        error: "Cancellation transaction did not complete successfully.",
      };
    }

    let cancelledTokenId: bigint | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== subscriptionRegistryAddress.toLowerCase()) {
        continue;
      }

      try {
        const decoded = decodeEventLog({
          abi: SubscriptionRegistryABI as any,
          data: log.data,
          topics: log.topics,
        }) as { eventName: string; args: Record<string, unknown> };
        if (decoded.eventName === "SubscriptionCancelled") {
          const args = decoded.args as unknown as { tokenId: bigint };
          cancelledTokenId = args.tokenId;
          break;
        }
      } catch {
        // Ignore unrelated logs on the same contract.
      }
    }

    if (!cancelledTokenId || cancelledTokenId <= 0n) {
      return {
        ok: false,
        status: 409,
        error:
          "Transaction did not emit SubscriptionCancelled. The subscription token was not cancelled.",
      };
    }

    const [walletTokenId, tokenFeatures, cancelledAt] = await Promise.all([
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "getWalletSubscription",
        args: [params.paymentAccount as `0x${string}`],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "getPlanFeatures",
        args: [cancelledTokenId],
      }) as Promise<{ planId?: bigint }>,
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "expiresAt",
        args: [cancelledTokenId],
      }) as Promise<bigint>,
    ]);

    if (walletTokenId !== cancelledTokenId) {
      return {
        ok: false,
        status: 409,
        error:
          "The cancelled subscription token does not belong to the current payment account.",
      };
    }

    return {
      ok: true,
      txHash: params.txHash,
      tokenId: cancelledTokenId.toString(),
      onChainPlanId: BigInt(tokenFeatures?.planId ?? 0n).toString(),
      cancelledAt: new Date(Number(cancelledAt) * 1000).toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error:
        error instanceof Error
          ? error.message
          : "Could not verify the on-chain cancellation transaction.",
    };
  }
}
