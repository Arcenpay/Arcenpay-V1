/**
 * PATCH  /api/v1/components/:id  — update a custom component
 * DELETE /api/v1/components/:id  — delete a custom component
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  elements: z.array(z.record(z.unknown())).optional(),
  design: z.record(z.unknown()).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const teamId = auth.team.teamId;

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const existing = await db.embedComponent.findFirst({
    where: { id, teamId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Component not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.elements !== undefined) data.elements = parsed.data.elements;
  if (parsed.data.design !== undefined) data.design = parsed.data.design;

  const component = await db.embedComponent.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      elements: true,
      design: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ data: component });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const teamId = auth.team.teamId;

  const existing = await db.embedComponent.findFirst({
    where: { id, teamId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Component not found" }, { status: 404 });
  }

  await db.embedComponent.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
