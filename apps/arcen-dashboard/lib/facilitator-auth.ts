import { NextRequest, NextResponse } from "next/server";
import { FACILITATOR_SECRET } from "@/lib/config";

const isProdRuntime =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";

function getBearerToken(request: NextRequest): string {
  return request.headers.get("authorization")?.replace("Bearer ", "").trim() ?? "";
}

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
  request: NextRequest,
): NextResponse | null {
  if (!FACILITATOR_SECRET) {
    if (isProdRuntime) {
      return NextResponse.json(
        {
          error:
            "FACILITATOR_SECRET is not configured. Internal ingestion endpoints are disabled in production.",
        },
        { status: 503 },
      );
    }
    return null;
  }

  if (getBearerToken(request) !== FACILITATOR_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
