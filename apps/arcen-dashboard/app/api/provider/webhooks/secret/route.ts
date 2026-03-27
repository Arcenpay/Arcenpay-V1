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
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await resolveTeamContext(session);
  if (!ctx)
    return NextResponse.json({ error: "No team found" }, { status: 403 });

  const { teamId } = ctx;

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
    userId: session.clerkUserId,
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
