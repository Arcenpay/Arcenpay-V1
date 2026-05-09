/**
 * PATCH  /api/v1/components/:id  — update a custom component
 * DELETE /api/v1/components/:id  — delete a custom component
 */

import type { Context } from "hono";
import { z } from "zod";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  elements: z.array(z.record(z.unknown())).optional(),
  design: z.record(z.unknown()).optional(),
});

export async function PATCH(c: Context) {
  const id = c.req.param("id");

  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const teamId = auth.team.teamId;

  const body = await c.req.json() .catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const existing = await db.embedComponent.findFirst({
    where: { id, teamId },
  });
  if (!existing) {
    return c.json({ error: "Component not found" }, 404 as any);
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

  return c.json({ data: component });
}

export async function DELETE(c: Context) {
  const id = c.req.param("id");

  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const teamId = auth.team.teamId;

  const existing = await db.embedComponent.findFirst({
    where: { id, teamId },
  });
  if (!existing) {
    return c.json({ error: "Component not found" }, 404 as any);
  }

  await db.embedComponent.delete({ where: { id } });

  return c.json({ ok: true });
}
