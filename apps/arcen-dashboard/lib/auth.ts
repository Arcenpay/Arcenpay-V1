// ============================================================
//  Dashboard — Auth helpers
//  Client-safe: can be imported by both server and client code.
//  No next/headers imports here.
// ============================================================

import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET_KEY =
  process.env.SIWE_JWT_SECRET || "dev_secret_change_in_production";
export const COOKIE_NAME = "meap-session";
const JWT_EXPIRY = "24h";
const NONCE_TTL_MS = 5 * 60 * 1000;

// ── Nonce store (in-memory; swap for Redis in production) ─────────────────────

type NonceRecord = {
  issuedAt: string;
  expiresAt: number;
};
const nonceStore = new Map<string, NonceRecord>();

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Generates a cryptographically random nonce and stores it for 5 minutes */
export function generateNonce(): NonceRecord & { nonce: string } {
  const nonce = randomHex(16);
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + NONCE_TTL_MS;
  nonceStore.set(nonce, { issuedAt, expiresAt });
  return { nonce, issuedAt, expiresAt };
}

/** Validates and consumes a nonce (one-time use) */
export function consumeNonce(nonce: string): NonceRecord | null {
  const record = nonceStore.get(nonce);
  if (!record) return null;
  if (Date.now() > record.expiresAt) {
    nonceStore.delete(nonce);
    return null;
  }
  nonceStore.delete(nonce);
  return record;
}

// ── Session payload types ─────────────────────────────────────────────────────

export type TeamRole =
  | "OWNER"
  | "ADMIN"
  | "FINANCE"
  | "DEVELOPER"
  | "SUPPORT"
  | "MEMBER";

export type SessionPayload =
  | {
      authMethod: "siwe";
      address: string;
      chainId: number;
      userId?: string;
      email?: string;
      /** Active team for this session */
      teamId?: string;
      teamRole?: TeamRole;
      /**
       * True when the user just signed in with wallet but has no email yet.
       * The login page uses this to show the "add email" step.
       */
      needsEmail?: boolean;
      isProvider: boolean;
    }
  | {
      authMethod: "magic";
      userId: string;
      email: string;
      address?: string;
      teamId?: string;
      teamRole?: TeamRole;
      isProvider: boolean;
    };

// ── JWT helpers ───────────────────────────────────────────────────────────────

export type SIWEExtras = {
  userId?: string;
  email?: string;
  teamId?: string;
  teamRole?: TeamRole;
  needsEmail?: boolean;
};

/** Issues a signed JWT for a wallet (SIWE) session */
export async function createSession(
  address: string,
  chainId: number,
  extras: SIWEExtras = {},
): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET_KEY);
  const payload: SessionPayload = {
    authMethod: "siwe",
    address,
    chainId,
    isProvider: true,
    ...extras,
  };
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(secret);
}

export type EmailExtras = {
  linkedWallet?: string;
  teamId?: string;
  teamRole?: TeamRole;
};

/** Issues a signed JWT for a magic-link (email) session */
export async function createEmailSession(
  userId: string,
  email: string,
  extras: EmailExtras = {},
): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET_KEY);
  const { linkedWallet, teamId, teamRole } = extras;
  const payload: SessionPayload = {
    authMethod: "magic",
    userId,
    email,
    isProvider: true,
    ...(linkedWallet ? { address: linkedWallet } : {}),
    ...(teamId ? { teamId } : {}),
    ...(teamRole ? { teamRole } : {}),
  };
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(secret);
}

/** Verifies a JWT — returns null if invalid or expired */
export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET_KEY);
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// ── SIWE message builder ──────────────────────────────────────────────────────

/** Builds a SIWE (EIP-4361) message — safe to call client-side */
export function buildSIWEMessage(params: {
  address: string;
  chainId: number;
  nonce: string;
  domain?: string;
  uri?: string;
  issuedAt?: string;
}): string {
  const {
    address,
    chainId,
    nonce,
    domain = "arcenpay.xyz",
    uri = "https://arcenpay.xyz",
    issuedAt = new Date().toISOString(),
  } = params;
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to ArcenPay Provider Dashboard",
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

// ── Team helpers ──────────────────────────────────────────────────────────────

/** Generates a URL-safe slug from a display name */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
