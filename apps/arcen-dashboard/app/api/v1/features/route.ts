/**
 * GET  /api/v1/features  — List all features for the team
 * POST /api/v1/features  — Create a new feature
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";

function toUiFeatureType(
  featureType: string | null | undefined,
): "boolean" | "event" | "trait" {
  switch (featureType) {
    case "event":
    case "event_based":
      return "event";
    case "trait":
    case "trait_based":
    case "zktls":
      return "trait";
    default:
      return "boolean";
  }
}

function toStoredFeatureType(
  featureType: string,
): "boolean" | "event_based" | "trait_based" {
  switch (featureType) {
    case "event":
    case "event_based":
      return "event_based";
    case "trait":
    case "trait_based":
      return "trait_based";
    default:
      return "boolean";
  }
}

async function requireTeamId(request: NextRequest): Promise<string | NextResponse> {
  void request; // unused but kept for future middleware use
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await resolveTeamContext(session);
  if (!ctx) {
    return NextResponse.json({ error: "No team found" }, { status: 403 });
  }
  return ctx.teamId;
}

// ── GET — list features ───────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const result = await requireTeamId(request);
  if (result instanceof NextResponse) return result;
  const teamId = result;

  const flags = await db.catalogFeatureFlag.findMany({
    where: { teamId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      featureKey: true,
      featureType: true,
      eventKey: true,
      description: true,
      createdAt: true,
    },
  });

  const features = flags.map((f) => ({
    id: f.id,
    name: f.name,
    featureKey: f.featureKey,
    featureType: toUiFeatureType(f.featureType),
    eventKey: f.eventKey ?? null,
    traitKey: null, // not stored in schema; reserved for future use
    description: f.description ?? null,
    linkedPlans: [] as string[],
    createdAt: f.createdAt.toISOString(),
  }));

  return NextResponse.json({ features });
}

// ── POST — create feature ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const result = await requireTeamId(request);
  if (result instanceof NextResponse) return result;
  const teamId = result;

  let body: {
    name?: string;
    featureKey?: string;
    featureType?: string;
    eventKey?: string | null;
    traitKey?: string | null;
    description?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.featureKey?.trim()) {
    return NextResponse.json({ error: "featureKey is required" }, { status: 400 });
  }
  if (!/^[a-z0-9_]+$/.test(body.featureKey)) {
    return NextResponse.json(
      { error: "featureKey must be lowercase alphanumeric with underscores only" },
      { status: 400 },
    );
  }

  const featureType = body.featureType ?? "boolean";
  const validTypes = ["boolean", "event", "trait", "event_based", "trait_based"];
  if (!validTypes.includes(featureType)) {
    return NextResponse.json({ error: "Invalid featureType" }, { status: 400 });
  }

  // Check for duplicate featureKey within team
  const existing = await db.catalogFeatureFlag.findUnique({
    where: { teamId_featureKey: { teamId, featureKey: body.featureKey } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "A feature with this key already exists" },
      { status: 409 },
    );
  }

  const flag = await db.catalogFeatureFlag.create({
    data: {
      teamId,
      name: body.name.trim(),
      featureKey: body.featureKey.trim(),
      featureType: toStoredFeatureType(featureType),
      eventKey: body.eventKey ?? null,
      description: body.description ?? null,
      defaultValue: false,
    },
  });

  const feature = {
    id: flag.id,
    name: flag.name,
    featureKey: flag.featureKey,
    featureType: toUiFeatureType(flag.featureType),
    eventKey: flag.eventKey ?? null,
    traitKey: null,
    description: flag.description ?? null,
    linkedPlans: [] as string[],
    createdAt: flag.createdAt.toISOString(),
  };

  return NextResponse.json({ feature }, { status: 201 });
}
