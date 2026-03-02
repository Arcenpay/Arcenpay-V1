// ============================================================
//  Dashboard — SIWE Auth helpers
//  Client-safe: can be imported by both server and client code.
//  No next/headers imports here.
// ============================================================

import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET_KEY = process.env.SIWE_JWT_SECRET || "dev_secret_change_in_production";
export const COOKIE_NAME = "meap-session";
const JWT_EXPIRY = "24h";

// In-memory nonce store — swap for Redis in production
const nonceStore = new Map<string, number>();

/** Generates a cryptographically random nonce and stores it for 5 minutes */
export function generateNonce(): string {
  const nonce = Array.from({ length: 16 }, () =>
    Math.random().toString(36)[2]
  ).join("") + Date.now().toString(36);
  nonceStore.set(nonce, Date.now() + 5 * 60 * 1000);
  return nonce;
}

/** Validates and consumes a nonce (one-time use) */
export function consumeNonce(nonce: string): boolean {
  const expiresAt = nonceStore.get(nonce);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    nonceStore.delete(nonce);
    return false;
  }
  nonceStore.delete(nonce);
  return true;
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
}): string {
  const { address, chainId, nonce, domain = "arcenpay.xyz", uri = "https://arcenpay.xyz" } = params;
  const now = new Date().toISOString();
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
    `Issued At: ${now}`,
  ].join("\n");
}
