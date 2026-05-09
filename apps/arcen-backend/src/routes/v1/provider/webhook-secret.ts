import type { Context } from "hono";
import { randomBytes } from "crypto";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

export async function rotateWebhookSecret(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const { team } = auth;
  const teamId = team.teamId;

  const raw = randomBytes(32).toString("hex");
  const secret = `whsec_${raw}`;

  await db.providerProfile.upsert({
    where: { teamId },
    update: { webhookSigningSecret: secret },
    create: { teamId, webhookSigningSecret: secret },
    select: { teamId: true },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.webhook.secret.rotate",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    beforeData: null,
    afterData: { webhookSigningSecretRotated: true },
  });

  return c.json({ secret });
}
