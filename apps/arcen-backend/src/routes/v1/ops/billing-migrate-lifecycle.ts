import type { Context } from "hono";
import {
  isErrorResponse,
  requireTeamRoles,
} from "../../../lib/auth/api-auth.js";
import { migrateLegacySubscriptionChangeRequests } from "../../../lib/billing/subscription-change-requests.js";

export async function migrateLegacyBillingLifecycle(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any as any);
  }

  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const result = await migrateLegacySubscriptionChangeRequests({
    teamId: auth.team.teamId,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  return c.json({
    ok: true,
    ...result,
  });
}
