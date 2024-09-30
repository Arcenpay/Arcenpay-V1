import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWalletAdapter } from "../src/lib/wallet-adapter-factory";
import { SolanaWalletAdapter } from "../src/lib/solana-wallet-adapter";

describe("Solana wallet adapter", () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("factory returns a Solana adapter for Solana chainIds", () => {
    const adapter = createWalletAdapter(9_100_001);
    expect(adapter?.family).toBe("solana");
    expect(adapter).toBeInstanceOf(SolanaWalletAdapter);
    expect(adapter?.chainId).toBe(9_100_001);
  });

  it("reports not installed when no injected provider is present", () => {
    const adapter = new SolanaWalletAdapter(9_100_001);
    expect(adapter.isInstalled).toBe(false);
    expect(adapter.address).toBeNull();
  });

  it("connects and disconnects via an injected provider", async () => {
    const connect = vi.fn(async () => ({
      publicKey: { toBase58: () => "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" },
    }));
    const disconnect = vi.fn(async () => {});
    (globalThis as { window?: unknown }).window = {
      solana: { connect, disconnect, publicKey: null },
    };

    const adapter = new SolanaWalletAdapter(9_100_001);
    expect(adapter.isInstalled).toBe(true);

    await adapter.connect();
    expect(adapter.address).toBe("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
    expect(adapter.isConnected).toBe(true);

    await adapter.disconnect();
    expect(adapter.isConnected).toBe(false);
    expect(adapter.address).toBeNull();
  });

  it("throws a clear error when connecting with no provider", async () => {
    const adapter = new SolanaWalletAdapter(9_100_001);
    await expect(adapter.connect()).rejects.toThrow(/No Solana wallet/);
  });
});
