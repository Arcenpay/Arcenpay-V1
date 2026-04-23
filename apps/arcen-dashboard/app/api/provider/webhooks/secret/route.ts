// ============================================================
//  POST /api/provider/webhooks/secret
//
//  Generates (or rotates) the webhook signing secret for the
//  current team.
//
//  The plaintext secret is returned ONCE — only the raw value
//  is stored (not hashed, since it's used for HMAC signing, not
//  authentication). It's never returned by GET /api/provider/webhooks.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { requireTeamRoles, isErrorResponse } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const { team } = auth;
  const teamId = team.teamId;

  // Generate a 32-byte random secret — prefix with "whsec_" for clarity
  const raw = randomBytes(32).toString("hex");
  const secret = `whsec_${raw}`;

  await db.providerProfile.upsert({
    where: { teamId },
    update: { webhookSigningSecret: secret },
    create: { teamId, webhookSigningSecret: secret },
    select: { teamId: true },
  });

  await writeAuditEvent({
    request: req,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.webhook.secret.rotate",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    beforeData: null,
    // Never log the secret itself
    afterData: { webhookSigningSecretRotated: true },
  });

  // Return the secret ONCE — caller must store it immediately
  return NextResponse.json({ secret });
}
