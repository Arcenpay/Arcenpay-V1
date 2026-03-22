/**
 * PATCH  /api/v1/components/:id  — update a custom component
 * DELETE /api/v1/components/:id  — delete a custom component
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";

async function resolveTeamId(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<string | null> {
  const ctx = await resolveTeamContext(session);
  return ctx?.teamId ?? null;
}

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

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamId = await resolveTeamId(session);
  if (!teamId) {
    return NextResponse.json({ error: "No team found" }, { status: 403 });
  }

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

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamId = await resolveTeamId(session);
  if (!teamId) {
    return NextResponse.json({ error: "No team found" }, { status: 403 });
  }

  const existing = await db.embedComponent.findFirst({
    where: { id, teamId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Component not found" }, { status: 404 });
  }

  await db.embedComponent.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
