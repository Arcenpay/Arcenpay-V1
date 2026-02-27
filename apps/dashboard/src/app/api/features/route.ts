import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import {
  DEFAULT_FLAGS,
  flagsToTierMatrix,
  TIERS,
  tierMatrixToFlags,
  type FeatureMatrixFlag,
} from "@/lib/featureFlags";
import {
  getTablelandService,
  isTablelandConfigured,
} from "@/lib/tableland-server";

export const runtime = "nodejs";

function isValidFlagKey(key: string): boolean {
  return /^[a-z0-9_]+$/i.test(key);
}

async function getSession() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.isLoggedIn || !session.address) return null;
  return session;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isTablelandConfigured()) {
    return NextResponse.json({
      ok: true,
      source: "default",
      flags: DEFAULT_FLAGS,
      tiers: TIERS,
    });
  }

  try {
    const service = await getTablelandService();
    const matrix = await service.listTierFeatureFlags(session.address, [...TIERS]);
    const resolved = tierMatrixToFlags(matrix as any);
    const hasPersisted = TIERS.some((tier) => Object.keys(matrix[tier] || {}).length > 0);
    return NextResponse.json({
      ok: true,
      source: hasPersisted ? "tableland" : "default",
      flags: hasPersisted ? resolved : DEFAULT_FLAGS,
      tiers: TIERS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to fetch feature flags.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!session.isProvider) {
    return NextResponse.json(
      { ok: false, error: "Provider role required." },
      { status: 403 },
    );
  }
  if (!isTablelandConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Tableland is not configured. Set TABLELAND_TABLE_NAME (+ signer envs for writes).",
      },
      { status: 503 },
    );
  }

  let body: { flags?: FeatureMatrixFlag[] };
  try {
    body = (await req.json()) as { flags?: FeatureMatrixFlag[] };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.flags) || body.flags.length === 0) {
    return NextResponse.json(
      { ok: false, error: "flags[] payload is required." },
      { status: 400 },
    );
  }

  for (const flag of body.flags) {
    if (!flag || typeof flag.key !== "string" || !isValidFlagKey(flag.key)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid flag key "${String(flag?.key ?? "")}". Use letters, numbers, underscore.`,
        },
        { status: 400 },
      );
    }
  }

  try {
    const service = await getTablelandService();
    const tierMatrix = flagsToTierMatrix(body.flags);

    for (const tier of TIERS) {
      const success = await service.setTierFeatureFlags(
        session.address,
        tier,
        tierMatrix[tier],
      );
      if (!success) {
        return NextResponse.json(
          { ok: false, error: `Failed to persist flags for tier "${tier}".` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      savedAt: new Date().toISOString(),
      flags: body.flags,
      tiers: TIERS,
      source: "tableland",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to save feature flags.",
      },
      { status: 500 },
    );
  }
}
