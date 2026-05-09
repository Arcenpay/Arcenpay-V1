/**
 * GET  /api/v1/components   — list all custom components for the team
 * POST /api/v1/components   — create a new custom component
 */

import type { Context } from "hono";
import { z } from "zod";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";

const ComponentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(""),
  elements: z.array(z.record(z.unknown())).default([]),
  design: z.record(z.unknown()).optional().default({}),
  template: z.string().optional().default("blank"),
});

export async function GET(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const teamId = auth.team.teamId;

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

  return c.json({ data: components });
}

export async function POST(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const teamId = auth.team.teamId;

  const body = await c.req.json() .catch(() => ({}));
  const parsed = ComponentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
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

  return c.json({ data: component }, 201 as any);
}
