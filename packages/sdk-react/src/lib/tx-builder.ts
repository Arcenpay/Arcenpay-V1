/**
 * Chain-Agnostic Transaction Builder
 *
 * Abstracts contract invocation across chain families.
 * The caller describes WHAT they want to do (contract, method, args);
 * the concrete builder handles HOW (EVM calldata vs Soroban simulation).
 */

import { type WalletAdapter, type EvmTxParams, type StellarTxParams, type SolanaTxParams } from "./wallet-adapter";
import { EvmWalletAdapter } from "./evm-wallet-adapter";
import { StellarWalletAdapter } from "./stellar-wallet-adapter";
import { SolanaWalletAdapter } from "./solana-wallet-adapter";
import {
  encodeFunctionData,
  type Abi,
  type ContractFunctionName,
} from "viem";

// ─── Call descriptor ─────────────────────────────────────────────────────────

export interface ContractCall {
  contractId: string;            // EVM: 0x... address; Stellar: C... address
  method: string;
  args: Record<string, unknown> | unknown[];
  value?: bigint;                // EVM only (native token value)
}

export interface ReadCall extends ContractCall {
  // For simulation / view calls (no signing needed)
}

// ─── Transaction builder interface ───────────────────────────────────────────

export interface TxBuilder {
  readonly family: string;
  readonly adapter: WalletAdapter;

  /** Build + send a write transaction. Returns txHash. */
  send(call: ContractCall): Promise<{ txHash: string; result?: unknown }>;

  /** Simulate / read a view function. Returns result. */
  read(call: ReadCall): Promise<unknown>;
}

// ─── EVM implementation ──────────────────────────────────────────────────

export class EvmTxBuilder implements TxBuilder {
  readonly family = "evm";
  readonly adapter: EvmWalletAdapter;

  constructor(adapter: EvmWalletAdapter) {
    this.adapter = adapter;
  }

  async send(call: ContractCall): Promise<{ txHash: string }> {
    // ArcenEmbed currently passes pre-encoded data in some paths;
    // this builder assumes the caller already encoded, or we add encoding later.
    // For now, we accept raw { to, data } from the caller via a helper.
    throw new Error("EvmTxBuilder.send: use sendRaw for pre-encoded transactions");
  }

  async sendRaw(params: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
    chainId: number;
  }): Promise<{ txHash: string }> {
    return this.adapter.sendTransaction({
      family: "evm",
      to: params.to,
      data: params.data,
      value: params.value,
      chainId: params.chainId,
    });
  }

  async read(_call: ReadCall): Promise<unknown> {
    // EVM reads are done via publicClient in the embed; not wired here yet.
    throw new Error("EvmTxBuilder.read: not implemented — use publicClient directly");
  }
}

// ─── Stellar implementation ────────────────────────────────────────────────

export class StellarTxBuilder implements TxBuilder {
  readonly family = "stellar";
  readonly adapter: StellarWalletAdapter;
  private rpcUrl: string;
  private networkPassphrase: string;

  constructor(adapter: StellarWalletAdapter, rpcUrl: string, networkPassphrase: string) {
    this.adapter = adapter;
    this.rpcUrl = rpcUrl;
    this.networkPassphrase = networkPassphrase;
  }

  async send(call: ContractCall): Promise<{ txHash: string; result?: unknown }> {
    const { txHash } = await this.adapter.sendTransaction({
      family: "stellar",
      contractId: call.contractId,
      method: call.method,
      args: call.args as Record<string, unknown>,
      networkPassphrase: this.networkPassphrase,
      rpcUrl: this.rpcUrl,
    });
    return { txHash };
  }

  async read(call: ReadCall): Promise<unknown> {
    // Simulation-only read: build client without signer, call simulate
    const { contract: stellarContract } = await import("@stellar/stellar-sdk");
    const client = (await stellarContract.Client.from({
      contractId: call.contractId,
      networkPassphrase: this.networkPassphrase,
      rpcUrl: this.rpcUrl,
      publicKey: this.adapter.address ?? undefined,
    })) as any;

    const tx = await (client as any)[call.method](call.args);
    const sim = await tx.simulate();
    return (sim as any)?.result ?? null;
  }
}

// ─── Solana implementation ────────────────────────────────────────────────

export class SolanaTxBuilder implements TxBuilder {
  readonly family = "solana";
  readonly adapter: SolanaWalletAdapter;
  private rpcUrl: string;

  constructor(adapter: SolanaWalletAdapter, rpcUrl: string) {
    this.adapter = adapter;
    this.rpcUrl = rpcUrl;
  }

  async send(call: ContractCall): Promise<{ txHash: string; result?: unknown }> {
    const args = (call.args ?? {}) as {
      keys?: SolanaTxParams["keys"];
      data?: string;
    };
    if (!args.keys || !args.data) {
      throw new Error(
        "SolanaTxBuilder.send requires args { keys, data } (a prepared instruction from the backend).",
      );
    }
    return this.sendPrepared({
      family: "solana",
      programId: call.contractId,
      keys: args.keys,
      data: args.data,
      rpcUrl: this.rpcUrl,
    });
  }

  /** Send a backend-prepared instruction. */
  async sendPrepared(
    params: SolanaTxParams,
  ): Promise<{ txHash: string; result?: unknown }> {
    const { txHash } = await this.adapter.sendTransaction(params);
    return { txHash };
  }

  async read(_call: ReadCall): Promise<unknown> {
    throw new Error(
      "SolanaTxBuilder.read: use a @solana/web3.js Connection directly",
    );
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createTxBuilder(
  adapter: WalletAdapter,
  rpcUrl?: string,
  networkPassphrase?: string,
): TxBuilder {
  if (adapter.family === "evm") {
    return new EvmTxBuilder(adapter as EvmWalletAdapter);
  }
  if (adapter.family === "stellar") {
    if (!rpcUrl || !networkPassphrase) {
      throw new Error("StellarTxBuilder requires rpcUrl and networkPassphrase");
    }
    return new StellarTxBuilder(adapter as StellarWalletAdapter, rpcUrl, networkPassphrase);
  }
  if (adapter.family === "solana") {
    if (!rpcUrl) {
      throw new Error("SolanaTxBuilder requires rpcUrl");
    }
    return new SolanaTxBuilder(adapter as SolanaWalletAdapter, rpcUrl);
  }
  throw new Error(`Unsupported chain family: ${adapter.family}`);
}
