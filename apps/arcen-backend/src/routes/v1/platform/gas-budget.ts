import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { requireFacilitatorAuth } from "../../../lib/auth/facilitator-auth.js";
import { getDailyGasSpend, getGasSpendHistory } from "../../../lib/platform/gas-policy.js";

export async function getGasBudget(c: Context) {
  const teamIdParam = c.req.query("teamId");
  const daysParam = c.req.query("days");
  const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 7, 1), 30) : 7;

  if (teamIdParam) {
    const authError = requireFacilitatorAuth(c.req.raw.headers);
    if (authError) return c.json({ error: authError.error }, authError.status as any as any as any);

    const [budget, history] = await Promise.all([
      getDailyGasSpend(teamIdParam),
      getGasSpendHistory(teamIdParam, days),
    ]);

    return c.json({
      budget,
      history,
    });
  }

  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const [budget, history] = await Promise.all([
    getDailyGasSpend(auth.team.teamId),
    getGasSpendHistory(auth.team.teamId, days),
  ]);

  return c.json({
    budget,
    history,
  });
}
