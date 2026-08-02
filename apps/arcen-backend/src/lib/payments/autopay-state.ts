import { isAddress } from "viem";
import {
  ERC7579AutopayModuleABI,
  getContractAddresses,
} from "@arcenpay/internal-core";
import { createResilientPublicClient } from "../../config.js";

export type AutopayAccountState = "ACTIVE" | "PAUSED" | "REVOKED" | null;

export async function readAutopayAccountState(
  paymentAccount: string,
  chainId: number,
): Promise<AutopayAccountState> {
  if (!isAddress(paymentAccount)) return null;

  const contracts = getContractAddresses(chainId);
  const autopayAddress = contracts.autopayModule as `0x${string}` | undefined;
  if (!autopayAddress || !isAddress(autopayAddress)) return null;

  const publicClient = createResilientPublicClient(chainId);

  const isInitialized = (await publicClient.readContract({
    address: autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "isInitialized",
    args: [paymentAccount as `0x${string}`],
  })) as boolean;

  if (!isInitialized) return "REVOKED";

  const isPaused = (await publicClient.readContract({
    address: autopayAddress,
    abi: ERC7579AutopayModuleABI,
    functionName: "isAccountPaused",
    args: [paymentAccount as `0x${string}`],
  })) as boolean;

  return isPaused ? "PAUSED" : "ACTIVE";
}
