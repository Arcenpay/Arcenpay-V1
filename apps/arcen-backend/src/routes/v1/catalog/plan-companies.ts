import type { Context } from "hono";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";

export async function getPlanCompanies(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const teamId = auth.team.teamId;

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId },
    select: { id: true, name: true },
  });

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const search = c.req.query("search")?.trim();

  const companies = await db.arcenCompany.findMany({
    where: {
      teamId,
      activePlanId: id,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { walletAddress: { contains: search, mode: "insensitive" } },
              { externalId: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      email: true,
      walletAddress: true,
      externalId: true,
      activePlanId: true,
      createdAt: true,
      lastSeenAt: true,
    },
  });

  return c.json({
    data: companies,
    count: companies.length,
    plan,
  });
}
