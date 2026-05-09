/**
 * GET  /api/v1/features  — List all features for the team
 * POST /api/v1/features  — Create a new feature
 */

import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";
import { loadPublishedPlanLinksByFeatureKey } from "../../lib/catalog/catalog-entitlements.js";

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
): "boolean" | "event_based" {
  switch (featureType) {
    case "event":
    case "event_based":
      return "event_based";
    default:
      return "boolean";
  }
}

// ── GET — list features ───────────────────────────────────────────────────────

export async function GET(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const teamId = auth.team.teamId;

  const [flags, linkedPlansByFeatureKey] = await Promise.all([
    db.catalogFeatureFlag.findMany({
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
    }),
    loadPublishedPlanLinksByFeatureKey(teamId),
  ]);

  const features = flags.map((f) => ({
    id: f.id,
    name: f.name,
    featureKey: f.featureKey,
    featureType: toUiFeatureType(f.featureType),
    eventKey: f.eventKey ?? null,
    traitKey: null, // not stored in schema; reserved for future use
    description: f.description ?? null,
    linkedPlans: (linkedPlansByFeatureKey.get(f.featureKey) ?? []).map((plan) => plan.name),
    createdAt: f.createdAt.toISOString(),
  }));

  return c.json({ features });
}

// ── POST — create feature ─────────────────────────────────────────────────────

export async function POST(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const teamId = auth.team.teamId;

  let body: {
    name?: string;
    featureKey?: string;
    featureType?: string;
    eventKey?: string | null;
    traitKey?: string | null;
    description?: string | null;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  if (!body.name?.trim()) {
    return c.json({ error: "name is required" }, 400 as any);
  }
  if (!body.featureKey?.trim()) {
    return c.json({ error: "featureKey is required" }, 400 as any);
  }
  if (!/^[a-z0-9_]+$/.test(body.featureKey)) {
    return c.json({ error: "featureKey must be lowercase alphanumeric with underscores only" }, 400 as any);
  }

  const featureType = body.featureType ?? "boolean";
  const validTypes = ["boolean", "event", "event_based"];
  if (!validTypes.includes(featureType)) {
    return c.json({ error: "Invalid featureType" }, 400 as any);
  }
  if (body.traitKey) {
    return c.json({
        error:
          "Trait-based features are not yet supported by the persisted feature schema. Create the flag directly instead of using the feature shortcut.",
      }, 400 as any);
  }

  // Check for duplicate featureKey within team
  const existing = await db.catalogFeatureFlag.findUnique({
    where: { teamId_featureKey: { teamId, featureKey: body.featureKey } },
  });
  if (existing) {
    return c.json({ error: "A feature with this key already exists" }, 409 as any);
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

  return c.json({ feature }, 201 as any);
}
