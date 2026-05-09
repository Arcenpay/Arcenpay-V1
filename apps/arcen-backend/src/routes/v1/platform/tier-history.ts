import type { Context } from "hono";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";

export async function getTierHistory(c: Context) {
  const auth = await requirePermission(c, "audit:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "50", 10),
    100,
  );

  const history = await db.tierUpgradeHistory.findMany({
    where: { teamId: auth.team.teamId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return c.json({ history });
}
