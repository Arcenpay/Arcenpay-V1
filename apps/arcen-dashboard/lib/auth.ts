// ============================================================
//  Dashboard — SIWE Auth helpers
//  Client-safe: can be imported by both server and client code.
//  No next/headers imports here.
// ============================================================

import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET_KEY = process.env.SIWE_JWT_SECRET || "dev_secret_change_in_production";
export const COOKIE_NAME = "meap-session";
const JWT_EXPIRY = "24h";
const NONCE_TTL_MS = 5 * 60 * 1000;

// In-memory nonce store — swap for Redis in production
type NonceRecord = {
  issuedAt: string;
  expiresAt: number;
};
const nonceStore = new Map<string, NonceRecord>();

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (value) => value.toString(16).padStart(2, "0")).join("");
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

/** Issues a signed JWT */
export async function createSession(address: string, chainId: number): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET_KEY);
  return new SignJWT({ address, chainId, isProvider: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(secret);
}

/** Verifies a JWT token string — returns null if invalid */
export async function verifySession(token: string) {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET_KEY);
    const { payload } = await jwtVerify(token, secret);
    return payload as { address: string; chainId: number; isProvider: boolean };
  } catch {
    return null;
  }
}

/** Builds a SIWE (EIP-4361) message string — safe to call client-side */
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
