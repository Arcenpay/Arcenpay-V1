import { isAddress } from "viem";
import { Connection } from "@solana/web3.js";
import {
  ERC7579AutopayModuleABI,
  getChainFamily,
  getContractAddresses,
  getSolanaRpcUrl,
} from "@arcenpay/internal-core";
import {
  decodeSubscriptionRecord,
  findSubscriptionByWalletPda,
  findSubscriptionPda,
} from "./solana-instruction.js";
import { createResilientPublicClient } from "../../config.js";

export type AutopayAccountState = "ACTIVE" | "PAUSED" | "REVOKED" | null;

/**
 * Reads whether a payment account's standing autopay authority is still live.
 *
 * EVM: ERC-7579 AutopayModule (`isInitialized` / `isAccountPaused`).
 * Solana: the Anchor program's subscription snapshot — `autopay_enabled` on the
 *   subscription PDA. A missing/inactive subscription means nothing on-chain can
 *   charge the wallet ("REVOKED").
 */
export async function readAutopayAccountState(
  paymentAccount: string,
  chainId: number,
): Promise<AutopayAccountState> {
  if (getChainFamily(chainId) === "solana") {
    return readSolanaAutopayState(paymentAccount, chainId);
  }

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

async function readSolanaAutopayState(
  owner: string,
  chainId: number,
): Promise<AutopayAccountState> {
  const programId = getContractAddresses(chainId).subscriptionRegistry;
  const rpcUrl = getSolanaRpcUrl(chainId);
  if (!programId || !rpcUrl) return null;

  try {
    const connection = new Connection(rpcUrl, "confirmed");
    // wallet index PDA → token id → subscription PDA (the snapshot lives there).
    const [byWallet] = findSubscriptionByWalletPda(programId, owner);
    const link = await connection.getAccountInfo(byWallet, "confirmed");
    if (!link) return "REVOKED";
    const tokenId = link.data.readBigUInt64LE(40);
    const [subscription] = findSubscriptionPda(programId, tokenId);
    const info = await connection.getAccountInfo(subscription, "confirmed");
    if (!info) return "REVOKED";
    const record = decodeSubscriptionRecord(info.data);
    if (!record || !record.active) return "REVOKED";
    return record.autopayEnabled ? "ACTIVE" : "PAUSED";
  } catch {
    return null;
  }
}
