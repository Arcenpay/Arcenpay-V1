import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  encodeSubscribe,
  findPlanPda,
  findSubscriptionPda,
  findSubscriptionByWalletPda,
  findAssociatedTokenAddress,
  decodePlanRecord,
  decodeConfigRecord,
} from "../../../src/lib/payments/solana-instruction";

const PROGRAM = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";

const disc = (name: string) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

const u64 = (v: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const i64 = (v: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(v));
  return b;
};

describe("encodeSubscribe", () => {
  it("encodes the Anchor discriminator + token_id + amount", () => {
    const data = encodeSubscribe(7, 10_000_000);
    expect(data.length).toBe(24);
    expect(data.subarray(0, 8).toString("hex")).toBe(disc("subscribe").toString("hex"));
    expect(data.readBigUInt64LE(8)).toBe(7n);
    expect(data.readBigUInt64LE(16)).toBe(10_000_000n);
  });
});

describe("Solana PDA derivation", () => {
  const program = new PublicKey(PROGRAM);

  it("derives plan/subscription PDAs deterministically and seed-scoped", () => {
    const [p1] = findPlanPda(PROGRAM, 1);
    const [p1b] = findPlanPda(PROGRAM, 1);
    const [p2] = findPlanPda(PROGRAM, 2);
    expect(p1.toBase58()).toBe(p1b.toBase58());
    expect(p1.toBase58()).not.toBe(p2.toBase58());

    const [manualPlan] = PublicKey.findProgramAddressSync(
      [Buffer.from("plan"), u64(1)],
      program,
    );
    expect(p1.toBase58()).toBe(manualPlan.toBase58());

    const owner = Keypair.generate().publicKey;
    const [sub] = findSubscriptionPda(PROGRAM, 42);
    const [manualSub] = PublicKey.findProgramAddressSync(
      [Buffer.from("subscription"), u64(42)],
      program,
    );
    expect(sub.toBase58()).toBe(manualSub.toBase58());

    const [byWallet] = findSubscriptionByWalletPda(PROGRAM, owner);
    const [manualByWallet] = PublicKey.findProgramAddressSync(
      [Buffer.from("subscription_wallet"), owner.toBuffer()],
      program,
    );
    expect(byWallet.toBase58()).toBe(manualByWallet.toBase58());
  });

  it("derives the associated token address", () => {
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const ata = findAssociatedTokenAddress(owner, mint);
    const [manual] = PublicKey.findProgramAddressSync(
      [
        owner.toBuffer(),
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
        mint.toBuffer(),
      ],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    );
    expect(ata.toBase58()).toBe(manual.toBase58());
  });
});

describe("account decoders", () => {
  it("decodes a Plan account", () => {
    const provider = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const data = Buffer.concat([
      Buffer.alloc(8),
      u64(1),
      provider.toBuffer(),
      u64(2_500_000),
      i64(2_592_000),
      mint.toBuffer(),
      Buffer.from([1]),
      Buffer.from([253]),
    ]);
    const plan = decodePlanRecord(data);
    expect(plan).not.toBeNull();
    expect(plan!.planId).toBe(1n);
    expect(plan!.provider).toBe(provider.toBase58());
    expect(plan!.price).toBe(2_500_000n);
    expect(plan!.billingInterval).toBe(2_592_000n);
    expect(plan!.acceptedToken).toBe(mint.toBase58());
    expect(plan!.active).toBe(true);
  });

  it("decodes a Config account", () => {
    const admin = Keypair.generate().publicKey;
    const treasury = Keypair.generate().publicKey;
    const data = Buffer.concat([
      Buffer.alloc(8),
      admin.toBuffer(),
      treasury.toBuffer(),
      u64(50),
      u64(3),
      Buffer.from([254]),
    ]);
    const config = decodeConfigRecord(data);
    expect(config).not.toBeNull();
    expect(config!.admin).toBe(admin.toBase58());
    expect(config!.treasury).toBe(treasury.toBase58());
    expect(config!.feeBps).toBe(50n);
  });

  it("returns null on truncated data", () => {
    expect(decodePlanRecord(Buffer.alloc(12))).toBeNull();
    expect(decodeConfigRecord(Buffer.alloc(12))).toBeNull();
  });
});
