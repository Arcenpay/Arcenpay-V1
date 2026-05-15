import type { Context } from "hono";
import { getBillingRuntimeSummary } from "../../../lib/billing/billing-runtime.js";
import { isErrorResponse, requireTeamRoles } from "../../../lib/auth/api-auth.js";

export async function getBillingRuntime(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN", "FINANCE", "SUPPORT"]);
  if (isErrorResponse(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any as any);
  }

  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  return c.json(
    await getBillingRuntimeSummary({
      teamId: auth.team.teamId,
      limit: Number.isFinite(limit) ? limit : undefined,
    }),
  );
}
