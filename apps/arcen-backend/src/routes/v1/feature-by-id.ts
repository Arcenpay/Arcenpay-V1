/**
 * PUT    /api/v1/features/[id]  — Update a feature by id
 * DELETE /api/v1/features/[id]  — Delete a feature by id
 */

import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";

export async function DELETE(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const teamId = auth.team.teamId;
  const id = c.req.param("id");

  const flag = await db.catalogFeatureFlag.findFirst({
    where: { id, teamId },
    select: { id: true },
  });

  if (!flag) {
    return c.json({ error: "Feature not found" }, 404 as any);
  }

  await db.catalogFeatureFlag.delete({ where: { id } });

  return c.json({ ok: true });
}

export async function PUT(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const teamId = auth.team.teamId;
  const id = c.req.param("id");

  const existing = await db.catalogFeatureFlag.findFirst({
    where: { id, teamId },
    select: {
      id: true,
      createdAt: true,
    },
  });

  if (!existing) {
    return c.json({ error: "Feature not found" }, 404 as any);
  }

  let body: {
    name?: string;
    description?: string | null;
    featureType?: "boolean" | "event" | "event_based";
    eventKey?: string | null;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  if (!body.name?.trim()) {
    return c.json({ error: "name is required" }, 400 as any);
  }

  const nextFeatureType = body.featureType ?? "boolean";
  if (!["boolean", "event", "event_based"].includes(nextFeatureType)) {
    return c.json({ error: "Invalid featureType" }, 400 as any);
  }

  if (
    nextFeatureType !== "boolean" &&
    (!body.eventKey?.trim() || !/^[a-z0-9_]+$/.test(body.eventKey))
  ) {
    return c.json({ error: "eventKey is required for event-based features and must use lowercase alphanumeric with underscores" }, 400 as any);
  }

  const updated = await db.catalogFeatureFlag.update({
    where: { id },
    data: {
      name: body.name.trim(),
      description: body.description?.trim() || null,
      featureType: nextFeatureType === "boolean" ? "boolean" : "event_based",
      eventKey: nextFeatureType === "boolean" ? null : body.eventKey!.trim(),
    },
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

  return c.json({
    feature: {
      id: updated.id,
      name: updated.name,
      featureKey: updated.featureKey,
      featureType: updated.featureType === "event_based" ? "event" : "boolean",
      eventKey: updated.eventKey,
      traitKey: null,
      description: updated.description,
      linkedPlans: [] as string[],
      createdAt: updated.createdAt.toISOString(),
    },
  });
}
