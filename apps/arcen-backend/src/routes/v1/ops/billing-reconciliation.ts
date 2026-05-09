import type { Context } from "hono";
import { getBillingReconciliationSummary } from "../../../lib/billing/billing-reconciliation.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

export async function getReconciliation(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const summary = await getBillingReconciliationSummary({
    teamId: auth.team.teamId,
  });

  return c.json(summary);
}
