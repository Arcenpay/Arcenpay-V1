import type { Context } from "hono";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

export async function revokeApiKeyById(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const { team } = auth;
  const teamId = team.teamId;

  const id = c.req.param("id");

  const keyRecord = await db.arcenApiKey.findFirst({
    where: { id, teamId },
    select: { id: true, prefix: true },
  });

  if (!keyRecord) {
    return c.json({ error: "API key not found" }, 404 as any);
  }

  await db.arcenApiKey.delete({ where: { id } });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.api_key.revoke",
    resourceType: "ArcenApiKey",
    resourceId: id,
    metadata: { prefix: keyRecord.prefix },
  });

  return c.json({ ok: true });
}
