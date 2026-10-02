// ============================================================
//  ArcenPay Internal Core — Solana / Anchor codec
//
//  Single source of truth for the ArcenPay Solana program's
//  instruction encoding, PDA derivation and account decoding.
//  Consumed by the facilitator, backend and SDKs (via the vendored
//  internal/core copy) so the layout can never drift between them.
//
//  Layouts MUST match packages/solana-programs/programs/arcenpay-solana.
//  Instruction discriminators are sha256("global:<name>")[0..8].
//  Account discriminators are sha256("account:<Name>")[0..8].
//
//  Node-only (uses Buffer + node:crypto) — not imported by browser code.
// ============================================================

import { createHash } from "node:crypto";
import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import { getSolanaRpcUrls } from "../chain-family.js";

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111",
);

// ─── RPC connection (env-driven, with endpoint failover) ────────────────────

/**
 * A Solana `Connection` with endpoint failover.
 *
 * The RPC endpoint comes from env (`ARCENPAY_SOLANA_RPC_URL_<chainId>` /
 * `SOLANA_RPC_URL_<chainId>`). If that value holds several comma-separated URLs,
 * a request answered with 429/5xx (or a network error) is retried against the
 * next endpoint and the healthy one is remembered — so a chain keeps working
 * when one provider rate-limits, and upgrading to a paid RPC is purely an env
 * change (`...=https://paid.example,https://api.devnet.solana.com`).
 */
export function createSolanaConnection(
  chainId: number,
  commitment: Commitment = "confirmed",
): Connection {
  const urls = getSolanaRpcUrls(chainId);
  if (urls.length === 0) {
    throw new Error(`[createSolanaConnection] No RPC URL configured for Solana chain ${chainId}.`);
  }
  if (urls.length === 1) return new Connection(urls[0], commitment);

  let preferred = 0;
  const fetchWithFailover: typeof fetch = async (_input, init) => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < urls.length; attempt += 1) {
      const index = (preferred + attempt) % urls.length;
      const target = urls[index];
      try {
        const response = await fetch(target, init);
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`RPC ${target} responded ${response.status}`);
          continue;
        }
        preferred = index;
        return response;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("All Solana RPC endpoints failed");
  };

  return new Connection(urls[0], { commitment, fetch: fetchWithFailover });
}

// ─── base58 ─────────────────────────────────────────────────────────────────

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_LOOKUP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i += 1) map[BASE58_ALPHABET[i]] = i;
  return map;
})();

/** Decodes a Bitcoin-alphabet base58 string to bytes. Throws on invalid input. */
export function decodeBase58(value: string): Uint8Array {
  if (!value) throw new Error("decodeBase58: empty input");
  let num = 0n;
  for (const char of value) {
    const digit = BASE58_LOOKUP[char];
    if (digit === undefined) throw new Error(`decodeBase58: invalid character '${char}'`);
    num = num * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  for (let i = 0; i < value.length && value[i] === "1"; i += 1) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

/** Encodes bytes to a Bitcoin-alphabet base58 string. */
export function encodeBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = "";
  while (num > 0n) {
    out = BASE58_ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i += 1) out = "1" + out;
  return out;
}

/**
 * Parses a Solana secret key from either a base58 string or a JSON byte array
 * (`[1,2,…]`, the format `solana-keygen` writes).
 *
 * Fails closed on anything that is not a 64-byte Solana keypair secret — most
 * importantly a `0x…` EVM key, which is a common and silent misconfiguration
 * when the same `SETTLEMENT_PRIVATE_KEY` variable is shared across chain
 * families.
 */
export function parseSolanaSecretKey(input: string): Uint8Array {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("parseSolanaSecretKey: empty input");
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error(
      "parseSolanaSecretKey: received a 0x-prefixed EVM key. A Solana signer " +
        "needs a 64-byte keypair secret (base58 or JSON byte array), e.g. the " +
        "output of `solana-keygen new`.",
    );
  }
  const bytes = trimmed.startsWith("[")
    ? (() => {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!Array.isArray(parsed)) throw new Error("parseSolanaSecretKey: not an array");
        return Uint8Array.from(parsed as number[]);
      })()
    : decodeBase58(trimmed);
  if (bytes.length !== 64) {
    throw new Error(
      `parseSolanaSecretKey: expected a 64-byte Solana secret key, got ${bytes.length} bytes.`,
    );
  }
  return bytes;
}

// ─── Borsh helpers ──────────────────────────────────────────────────────────

/** Little-endian u64 → 8 bytes. */
export function u64le(value: bigint): Uint8Array {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

/** Minimal Borsh reader (little-endian). */
export class BorshReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}
  get remaining(): number {
    return this.buf.length - this.offset;
  }
  u8(): number {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
  u16(): number {
    const v = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }
  u64(): bigint {
    const v = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }
  i64(): bigint {
    const v = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    return v;
  }
  pubkey(): string {
    const bytes = this.buf.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return new PublicKey(bytes).toBase58();
  }
}

// ─── Instruction encoding ───────────────────────────────────────────────────

/** Anchor instruction discriminator for a snake_case instruction name. */
export function instructionDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

/**
 * Anchor account discriminator for a PascalCase account name. Used to filter
 * `getProgramAccounts` (e.g. discovering every `Subscription` for the renewal
 * worker) without an off-chain index.
 */
export function accountDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

function u64(value: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}
function i64(value: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(value));
  return b;
}
/** Borsh-encodes a `Vec<u8>` (u32 LE length prefix followed by the bytes). */
function vecU8(bytes: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, Buffer.from(bytes)]);
}
function pubkeyBytes(value: string | PublicKey): Buffer {
  return Buffer.from(
    (typeof value === "string" ? new PublicKey(value) : value).toBuffer(),
  );
}
function encode(name: string, ...args: Buffer[]): Buffer {
  return Buffer.concat([instructionDiscriminator(name), ...args]);
}

export function encodeInitializeConfig(
  treasury: string | PublicKey,
  feeBps: bigint | number,
): Buffer {
  return encode("initialize_config", pubkeyBytes(treasury), u64(feeBps));
}

export function encodeCreatePlan(
  planId: bigint | number,
  price: bigint | number,
  billingInterval: bigint | number,
  acceptedToken: string | PublicKey,
): Buffer {
  return encode(
    "create_plan",
    u64(planId),
    u64(price),
    i64(billingInterval),
    pubkeyBytes(acceptedToken),
  );
}

export function encodeUpdatePlan(
  price: bigint | number,
  billingInterval: bigint | number,
  active: boolean,
): Buffer {
  return encode("update_plan", u64(price), i64(billingInterval), Buffer.from([active ? 1 : 0]));
}

export function encodeSubscribe(
  tokenId: bigint | number,
  amount: bigint | number,
): Buffer {
  return encode("subscribe", u64(tokenId), u64(amount));
}

/** A relayer submits execute; charge amount is the immutable subscription snapshot. */
export function encodeExecute(): Buffer {
  return encode("execute");
}

export function encodeCancel(): Buffer {
  return encode("cancel");
}

export function encodeChangePlan(newPlanId: bigint | number): Buffer {
  return encode("change_plan", u64(newPlanId));
}

export function encodePauseAutopay(): Buffer {
  return encode("pause_autopay");
}

export function encodeReauthorizeAutopay(): Buffer {
  return encode("reauthorize_autopay");
}

export function encodeAuthorizeSettler(settler: string | PublicKey): Buffer {
  return encode("authorize_settler", pubkeyBytes(settler));
}

export function encodeFundSession(
  sessionId: bigint | number,
  amount: bigint | number,
): Buffer {
  return encode("fund_session", u64(sessionId), u64(amount));
}

export function encodeSettle(
  amount: bigint | number,
  callCount: bigint | number,
  nullifier: Uint8Array,
  proof: Uint8Array = new Uint8Array(),
  publicInputs: Uint8Array = new Uint8Array(),
): Buffer {
  if (nullifier.length !== 32) {
    throw new Error("encodeSettle: nullifier must be 32 bytes");
  }
  return encode(
    "settle",
    u64(amount),
    u64(callCount),
    Buffer.from(nullifier),
    vecU8(proof),
    vecU8(publicInputs),
  );
}

/** Admin-only: toggle the `settle` ZK proof gate and set the verifier program. */
export function encodeSetProofVerification(
  required: boolean,
  verifier: string | PublicKey,
): Buffer {
  return encode(
    "set_proof_verification",
    Buffer.from([required ? 1 : 0]),
    pubkeyBytes(verifier),
  );
}

/**
 * Admin-only, one-time: grow a pre-proof-gate `Config` account to the current
 * layout. Takes no arguments.
 */
export function encodeMigrateConfig(): Buffer {
  return encode("migrate_config");
}

/**
 * Admin-only recovery: close a subscription + its wallet index PDA, reclaiming
 * their rent. Recovers a deterministic PDA left stale by a program layout
 * upgrade (or a failed finalize) so the wallet can subscribe again.
 */
export function encodeCloseSubscription(
  tokenId: bigint | number,
  owner: string | PublicKey,
): Buffer {
  return encode("close_subscription", u64(tokenId), pubkeyBytes(owner));
}

export function encodeWithdrawSession(amount: bigint | number): Buffer {
  return encode("withdraw_session", u64(amount));
}

// ─── PDA derivation ─────────────────────────────────────────────────────────

function programKey(programId: string | PublicKey): PublicKey {
  return typeof programId === "string" ? new PublicKey(programId) : programId;
}
function keyBytes(value: string | PublicKey): Buffer {
  return (typeof value === "string" ? new PublicKey(value) : value).toBuffer();
}

export function findConfigPda(programId: string | PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programKey(programId));
}

export function findPlanPda(
  programId: string | PublicKey,
  planId: bigint | number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("plan"), u64(planId)],
    programKey(programId),
  );
}

export function findSubscriptionPda(
  programId: string | PublicKey,
  tokenId: bigint | number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("subscription"), u64(tokenId)],
    programKey(programId),
  );
}

export function findSubscriptionByWalletPda(
  programId: string | PublicKey,
  owner: string | PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("subscription_wallet"), keyBytes(owner)],
    programKey(programId),
  );
}

/**
 * SPL token-delegate authority for one `(owner, mint)` token account.
 *
 * The delegate is deliberately shared by every ArcenPay subscription charging
 * the same token account: an SPL token account has a single delegate slot, so
 * a per-subscription delegate would overwrite the previous subscription's
 * autopay authority the moment a second one is created.
 */
export function findSubscriptionDelegatePda(
  programId: string | PublicKey,
  owner: string | PublicKey,
  mint: string | PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("subscription_delegate"), keyBytes(owner), keyBytes(mint)],
    programKey(programId),
  );
}

export function findVaultAuthorityPda(programId: string | PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault")], programKey(programId));
}

export function findSessionPda(
  programId: string | PublicKey,
  agent: string | PublicKey,
  sessionId: bigint | number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("session"), keyBytes(agent), u64(sessionId)],
    programKey(programId),
  );
}

export function findSettlerPda(
  programId: string | PublicKey,
  settler: string | PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("settler"), keyBytes(settler)],
    programKey(programId),
  );
}

/** Replay-guard PDA for a 32-byte settlement nullifier. */
export function findNullifierPda(
  programId: string | PublicKey,
  nullifier: Uint8Array,
): [PublicKey, number] {
  if (nullifier.length !== 32) {
    throw new Error("findNullifierPda: nullifier must be 32 bytes");
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), Buffer.from(nullifier)],
    programKey(programId),
  );
}

export function findAssociatedTokenAddress(
  owner: string | PublicKey,
  mint: string | PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [keyBytes(owner), TOKEN_PROGRAM_ID.toBuffer(), keyBytes(mint)],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

// ─── Account decoders ───────────────────────────────────────────────────────

/** Plan: plan_id(u64) | provider(32) | price(u64) | billing_interval(i64) | accepted_token(32) | active(bool) | bump(u8) */
export function decodePlanRecord(data: Buffer): {
  planId: bigint;
  provider: string;
  price: bigint;
  billingInterval: bigint;
  acceptedToken: string;
  active: boolean;
} | null {
  try {
    const r = new BorshReader(data.subarray(8));
    return {
      planId: r.u64(),
      provider: r.pubkey(),
      price: r.u64(),
      billingInterval: r.i64(),
      acceptedToken: r.pubkey(),
      active: r.u8() !== 0,
    };
  } catch {
    return null;
  }
}

/** Config: admin(32) | treasury(32) | fee_bps(u64) | plan_count(u64) | bump(u8) */
export function decodeConfigRecord(data: Buffer): {
  admin: string;
  treasury: string;
  feeBps: bigint;
  planCount: bigint;
} | null {
  try {
    const r = new BorshReader(data.subarray(8));
    const admin = r.pubkey();
    const treasury = r.pubkey();
    const feeBps = r.u64();
    const planCount = r.u64();
    return { admin, treasury, feeBps, planCount };
  } catch {
    return null;
  }
}

/** Subscription V2: base fields followed by immutable autopay snapshot. */
export function decodeSubscriptionRecord(data: Buffer): {
  owner: string;
  tokenId: bigint;
  planId: bigint;
  planTier: number;
  expiration: bigint;
  active: boolean;
  mintedAt: bigint;
  lastRenewedAt: bigint;
  totalPaid: bigint;
  renewalPrice: bigint;
  renewalInterval: bigint;
  acceptedToken: string;
  provider: string;
  subscriberToken: string;
  providerToken: string;
  treasuryToken: string;
  authorizationExpiresAt: bigint;
  remainingRenewals: number;
  autopayEnabled: boolean;
} | null {
  try {
    const r = new BorshReader(data.subarray(8));
    const owner = r.pubkey();
    const tokenId = r.u64();
    const planId = r.u64();
    const planTier = r.u8();
    const expiration = r.i64();
    const active = r.u8() !== 0;
    const mintedAt = r.i64();
    const lastRenewedAt = r.i64();
    const totalPaid = r.u64();
    const renewalPrice = r.u64();
    const renewalInterval = r.i64();
    const acceptedToken = r.pubkey();
    const provider = r.pubkey();
    const subscriberToken = r.pubkey();
    const providerToken = r.pubkey();
    const treasuryToken = r.pubkey();
    const authorizationExpiresAt = r.i64();
    const remainingRenewals = r.u16();
    const autopayEnabled = r.u8() !== 0;
    r.u8(); // delegate bump
    return { owner, tokenId, planId, planTier, expiration, active, mintedAt, lastRenewedAt, totalPaid, renewalPrice, renewalInterval, acceptedToken, provider, subscriberToken, providerToken, treasuryToken, authorizationExpiresAt, remainingRenewals, autopayEnabled };
  } catch {
    return null;
  }
}

/** SubscriptionByWallet: owner(32) | token_id(u64) | bump(u8) */
export function decodeSubscriptionByWallet(data: Buffer): {
  owner: string;
  tokenId: bigint;
} | null {
  try {
    const r = new BorshReader(data.subarray(8));
    return { owner: r.pubkey(), tokenId: r.u64() };
  } catch {
    return null;
  }
}

/**
 * SPL Token account delegation header (fixed 165-byte layout):
 * mint(32) | owner(32) | amount(u64) | delegate(COption<Pubkey>) |
 * state(u8) | is_native(COption<u64>) | delegated_amount(u64) |
 * close_authority(COption<Pubkey>).
 *
 * Used by the renewal worker to confirm ArcenPay still holds the delegate and
 * that the remaining allowance covers a renewal — the preflight that turns a
 * foreign/overwritten delegate into a clear "reauthorization required" instead
 * of an opaque on-chain failure.
 */
export function decodeTokenAccountDelegation(data: Buffer): {
  amount: bigint;
  delegate: string | null;
  delegatedAmount: bigint;
} | null {
  try {
    if (data.length < 129) return null;
    const amount = data.readBigUInt64LE(64);
    const hasDelegate = data.readUInt32LE(72) === 1;
    const delegate = hasDelegate
      ? new PublicKey(data.subarray(76, 108)).toBase58()
      : null;
    const delegatedAmount = data.readBigUInt64LE(121);
    return { amount, delegate, delegatedAmount };
  } catch {
    return null;
  }
}

/** Session: agent(32) | session_id(u64) | token(32) | balance(u64) | total_funded(u64) | total_settled(u64) | active(bool) | created_at(i64) | bump(u8) */
export function decodeSessionRecord(data: Buffer): {
  agent: string;
  sessionId: bigint;
  token: string;
  balance: bigint;
  totalFunded: bigint;
  totalSettled: bigint;
  active: boolean;
  createdAt: bigint;
} | null {
  try {
    const r = new BorshReader(data.subarray(8));
    const agent = r.pubkey();
    const sessionId = r.u64();
    const token = r.pubkey();
    const balance = r.u64();
    const totalFunded = r.u64();
    const totalSettled = r.u64();
    const active = r.u8() !== 0;
    const createdAt = r.i64();
    return { agent, sessionId, token, balance, totalFunded, totalSettled, active, createdAt };
  } catch {
    return null;
  }
}
