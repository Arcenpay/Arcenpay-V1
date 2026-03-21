/**
 * GET  /api/v1/feature-flags   — List feature flags (dashboard session auth)
 * POST /api/v1/feature-flags   — Create a feature flag
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const ctx = await requirePermission("catalog:read");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;

  const flags = await db.catalogFeatureFlag.findMany({
    where: { teamId: team.teamId },
    include: {
      rules: {
        orderBy: { priority: "asc" },
        include: { conditions: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: flags });
}

export async function POST(req: NextRequest) {
  const ctx = await requirePermission("catalog:write");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;

  let body: {
    featureKey: string;
    name: string;
    description?: string;
    featureType?: string;
    eventKey?: string;
    unitSingular?: string;
    unitPlural?: string;
    defaultValue?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.featureKey || !body.name) {
    return NextResponse.json({ error: "featureKey and name are required" }, { status: 400 });
  }

  // ── Field length validation ──────────────────────────────────
  if (body.featureKey.length > 128) {
    return NextResponse.json({ error: "featureKey too long" }, { status: 400 });
  }
  if (body.name.length > 128) {
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  }
  if (body.description !== undefined && body.description.length > 256) {
    return NextResponse.json({ error: "description too long" }, { status: 400 });
  }

  // Validate featureKey format — must start and end with alphanumeric
  if (!/^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/i.test(body.featureKey)) {
    return NextResponse.json(
      { error: "featureKey must start and end with an alphanumeric character and contain only letters, numbers, hyphens, and underscores" },
      { status: 400 },
    );
  }

  const existing = await db.catalogFeatureFlag.findUnique({
    where: { teamId_featureKey: { teamId: team.teamId, featureKey: body.featureKey } },
  });

  if (existing) {
    return NextResponse.json({ error: "A flag with this key already exists" }, { status: 409 });
  }

  const flag = await db.catalogFeatureFlag.create({
    data: {
      teamId: team.teamId,
      featureKey: body.featureKey,
      name: body.name,
      description: body.description,
      featureType: body.featureType ?? "boolean",
      eventKey: body.eventKey,
      unitSingular: body.unitSingular,
      unitPlural: body.unitPlural,
      defaultValue: body.defaultValue ?? false,
    },
  });

  return NextResponse.json({ data: flag }, { status: 201 });
}
