/**
 * PUT    /api/v1/features/[id]  — Update a feature by id
 * DELETE /api/v1/features/[id]  — Delete a feature by id
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const teamId = auth.team.teamId;

  const { id } = await params;

  const flag = await db.catalogFeatureFlag.findFirst({
    where: { id, teamId },
    select: { id: true },
  });

  if (!flag) {
    return NextResponse.json({ error: "Feature not found" }, { status: 404 });
  }

  await db.catalogFeatureFlag.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const teamId = auth.team.teamId;
  const { id } = await params;

  const existing = await db.catalogFeatureFlag.findFirst({
    where: { id, teamId },
    select: {
      id: true,
      createdAt: true,
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Feature not found" }, { status: 404 });
  }

  let body: {
    name?: string;
    description?: string | null;
    featureType?: "boolean" | "event" | "event_based";
    eventKey?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const nextFeatureType = body.featureType ?? "boolean";
  if (!["boolean", "event", "event_based"].includes(nextFeatureType)) {
    return NextResponse.json({ error: "Invalid featureType" }, { status: 400 });
  }

  if (
    nextFeatureType !== "boolean" &&
    (!body.eventKey?.trim() || !/^[a-z0-9_]+$/.test(body.eventKey))
  ) {
    return NextResponse.json(
      { error: "eventKey is required for event-based features and must use lowercase alphanumeric with underscores" },
      { status: 400 },
    );
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

  return NextResponse.json({
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
