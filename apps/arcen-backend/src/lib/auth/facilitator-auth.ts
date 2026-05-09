const isProdRuntime =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";

function getBearerToken(headers: { get(name: string): string | null | undefined }): string {
  return headers.get("authorization")?.replace("Bearer ", "").trim() ?? "";
}

export type FaciliatorAuthError = { error: string; status: number };

/**
 * Validates facilitator → dashboard internal API authentication.
 *
 * Behavior:
 * - If FACILITATOR_SECRET is set, require matching Bearer token.
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

  if (getBearerToken(headers) !== facilitatorSecret) {
    return { error: "Forbidden", status: 403 };
  }

  return null;
}
