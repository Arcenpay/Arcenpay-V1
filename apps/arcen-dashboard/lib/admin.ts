/**
 * Centralized Platform Administrator Configuration & Utilities
 *
 * This is the single source of truth for dashboard platform admin authorization,
 * aligned directly with backend `PLATFORM_ADMIN_EMAILS` from `config.ts`.
 */

const envAdmins = (
  process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS ||
  process.env.PLATFORM_ADMIN_EMAILS ||
  ""
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const PLATFORM_ADMIN_EMAILS: string[] = [
  ...new Set([
    "admin@arcenpay.com",
    "support@arcenpay.com",
    ...envAdmins,
  ]),
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
