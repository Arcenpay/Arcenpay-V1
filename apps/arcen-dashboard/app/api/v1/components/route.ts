/**
 * GET  /api/v1/components   — list all custom components for the team
 * POST /api/v1/components   — create a new custom component
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

const ComponentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(""),
  elements: z.array(z.record(z.unknown())).default([]),
  design: z.record(z.unknown()).optional().default({}),
  template: z.string().optional().default("blank"),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamId = await resolveTeamId(session);
  if (!teamId) {
    return NextResponse.json({ data: [] });
  }

  const components = await db.embedComponent.findMany({
    where: { teamId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      elements: true,
      design: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ data: components });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamId = await resolveTeamId(session);
  if (!teamId) {
    return NextResponse.json({ error: "No team found" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = ComponentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { name, elements, design } = parsed.data;

  const component = await db.embedComponent.create({
    data: {
      teamId,
      name,
      elements: elements as object[],
      design: design as object,
    },
    select: {
      id: true,
      name: true,
      elements: true,
      design: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ data: component }, { status: 201 });
}
