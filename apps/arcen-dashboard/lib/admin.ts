/**
 * Centralized Platform Administrator Configuration & Utilities
 *
 * This is the single source of truth for dashboard platform admin authorization,
 * aligned directly with backend `PLATFORM_ADMIN_EMAILS` from `config.ts`.
 */

const envAdmins = (
  process.env.PLATFORM_ADMIN_EMAILS ||
  // NOT `NEXT_PUBLIC_*`: Next.js inlines every `NEXT_PUBLIC_` variable into the
  // browser bundle, which would publish the administrator allow-list to every
  // visitor. Reading only the server-side name keeps this list server-side.
  ""
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Platform administrator allow-list.
 *
 * SECURITY NOTE — this file is a UI affordance only. It decides which pages to
 * show, never what a caller is allowed to do. Every privileged operation is
 * re-authorised server-side by the backend (`PLATFORM_ADMIN_EMAILS` +
 * `requireAdminAuth`) and by `lib/auth.server.ts` for page gating, which is the
 * actual security boundary.
 *
 * The well-known addresses below are seeded ONLY outside production: a
 * hardcoded production allow-list cannot be revoked if one of those mailboxes
 * is ever compromised or changes hands.
 */
const WELL_KNOWN_DEV_ADMINS =
  process.env.NODE_ENV === "production"
    ? []
    : ["admin@arcenpay.com", "aditya@arcenpay.com", "support@arcenpay.com"];

export const PLATFORM_ADMIN_EMAILS: string[] = [
  ...new Set([...WELL_KNOWN_DEV_ADMINS, ...envAdmins]),
];

const ADMIN_EMAIL_SET = new Set<string>(
  PLATFORM_ADMIN_EMAILS.map((email) => email.toLowerCase().trim()),
);

/**
 * Returns true if the provided email matches any configured platform administrator.
 * Case-insensitive and whitespace-trimmed.
 */
export function isPlatformAdminEmail(email?: string | null): boolean {
  if (!email || typeof email !== "string") return false;
  return ADMIN_EMAIL_SET.has(email.toLowerCase().trim());
}
