import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { listAddOnGrantCompanies } from "../../../lib/companies/addon-grants.js";

export async function getAddOnGrants(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const grants = await listAddOnGrantCompanies(auth.team.teamId, id);
  return c.json({ grants });
}
