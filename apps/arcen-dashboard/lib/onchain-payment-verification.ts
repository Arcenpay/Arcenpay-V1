import { createPublicClient, decodeFunctionData, http, isAddress, type Chain } from "viem";
import { base, baseSepolia, sepolia } from "viem/chains";
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

  const chain = resolveChain();
  const publicClient = createPublicClient({
    chain,
    transport: http(getRpcUrl(chain.id)),
  });

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
