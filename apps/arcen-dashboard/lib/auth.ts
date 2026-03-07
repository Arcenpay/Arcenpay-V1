// ============================================================
//  Dashboard — Auth helpers (client-safe)
//  JWT and session logic have been moved to Clerk.
//  This file retains only the utilities still needed:
//    - TeamRole type (used by RBAC / team-session)
//    - buildSIWEMessage (used by wallet onboarding)
//    - slugify (used by team creation / team route)
// ============================================================

// ── Team role type ────────────────────────────────────────────────────────────

export type TeamRole =
  | "OWNER"
  | "ADMIN"
  | "FINANCE"
  | "DEVELOPER"
  | "SUPPORT"
  | "MEMBER";

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
