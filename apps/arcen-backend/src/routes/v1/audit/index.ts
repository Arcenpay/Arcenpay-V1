import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";

const querySchema = z.object({
  actorType: z.enum(["USER", "API", "SYSTEM"]).optional(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(cells: unknown[]): string {
  return cells.map(escapeCsvCell).join(",");
}

export async function getAuditLog(c: Context): Promise<Response> {
  const auth = await requirePermission(c, "audit:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const q = parsed.data;
  const entries = await db.auditEvent.findMany({
    where: {
      teamId: auth.team.teamId,
      ...(q.actorType && { actorType: q.actorType }),
      ...(q.action && { action: { contains: q.action, mode: "insensitive" } }),
      ...((q.from || q.to) && {
        createdAt: {
          ...(q.from && { gte: new Date(q.from) }),
          ...(q.to && { lte: new Date(q.to) }),
        },
      }),
    },
    orderBy: { createdAt: "desc" },
    take: q.limit,
    ...(q.cursor && { skip: 1, cursor: { id: q.cursor } }),
  });

  if (q.format === "csv") {
    const header = toCsvRow([
      "id",
      "timestamp",
      "actorType",
      "actorUserId",
      "actorAddress",
      "action",
      "resourceType",
      "resourceId",
      "requestId",
      "ip",
      "userAgent",
    ]);
    const rows = entries.map((e) =>
      toCsvRow([
        e.id,
        e.createdAt.toISOString(),
        e.actorType,
        e.actorUserId ?? "",
        e.actorAddress ?? "",
        e.action,
        e.resourceType,
        e.resourceId ?? "",
        e.requestId ?? "",
        e.ip ?? "",
        e.userAgent ?? "",
      ]),
    );
    const csv = [header, ...rows].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="audit-log-${Date.now()}.csv"`,
      },
    });
  }

  return c.json({
    entries,
    nextCursor:
      entries.length === q.limit ? entries[entries.length - 1]?.id : null,
  });
}
export const auditRoutes = new Hono().get("/", getAuditLog);
