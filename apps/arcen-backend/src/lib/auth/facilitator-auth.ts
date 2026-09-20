import { secureCompare } from "./secure-compare.js";

const isProdRuntime =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";

export type FaciliatorAuthError = { error: string; status: number };

function getBearerToken(headers: { get(name: string): string | null | undefined }): string {
  const raw = headers.get("authorization");
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return "";
  return trimmed.slice(7).trim();
}

/**
 * Verifies a facilitator → backend bearer token.
 *
 * SECURITY: the comparison is constant-time (`secureCompare`) because `!==` on
 * a shared secret is a byte-by-byte timing oracle. The scheme prefix is also
 * matched case-insensitively and the token is stripped regardless of how the
 * caller cased `Bearer`.
 */
export function verifyFacilitatorToken(
  headers: { get(name: string): string | null | undefined },
): boolean {
  const expected = (process.env.FACILITATOR_SECRET || "").trim();
  if (!expected) return false;
  return secureCompare(getBearerToken(headers), expected);
}

/**
 * Validates facilitator → dashboard internal API authentication.
 *
 * Behaviour:
 * - If FACILITATOR_SECRET is set, require a matching Bearer token (constant-time).
 * - If FACILITATOR_SECRET is missing:
 *   - production: deny (misconfiguration)
 *   - development/test: allow for local DX.
 */
export function requireFacilitatorAuth(
  headers: { get(name: string): string | null | undefined },
): FaciliatorAuthError | null {
  const facilitatorSecret = (process.env.FACILITATOR_SECRET || "").trim();

  if (!facilitatorSecret) {
    if (isProdRuntime) {
      return {
        error:
          "FACILITATOR_SECRET is not configured. Internal ingestion endpoints are disabled in production.",
        status: 503,
      };
    }
    return null;
  }

  if (!verifyFacilitatorToken(headers)) {
    return { error: "Forbidden", status: 403 };
  }

  return null;
}
