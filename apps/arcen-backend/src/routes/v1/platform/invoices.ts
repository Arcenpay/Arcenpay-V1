import type { Context } from "hono";
import { db } from "../../../db.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

/**
 * GET /api/v1/platform/invoices
 *
 * Returns all self-billing invoices (generated from platform subscription activations)
 * for the current team.
 */
export async function getPlatformInvoices(c: Context) {
  const auth = await requireTeamRoles(c, [
    "OWNER", "ADMIN", "FINANCE", "DEVELOPER", "SUPPORT", "MEMBER",
  ]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const invoices = await db.invoice.findMany({
    where: {
      teamId: auth.team.teamId,
      metadata: {
        path: ["source"],
        equals: "platform-tier-activation",
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      currency: true,
      issuedAt: true,
      createdAt: true,
      metadata: true,
    },
  });

  return c.json({ invoices });
}
