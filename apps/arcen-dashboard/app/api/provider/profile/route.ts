// ============================================================
//  Dashboard API — Provider Profile
//  GET  /api/provider/profile  — read profile for current session
//  PUT  /api/provider/profile  — upsert profile
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";

const EMPTY_PROFILE = {
  notifyEmail: true,
  notifyWebhook: false,
  webhookUrl: null,
  apiKeyPrefix: null,
};

const UpdateSchema = z.object({
  notifyEmail: z.boolean().optional(),
  notifyWebhook: z.boolean().optional(),
  webhookUrl: z
    .string()
    .url("Invalid webhook URL")
    .optional()
    .or(z.literal("")),
});

/** Resolves teamId from session — looks up DB if not in JWT */
async function resolveTeamId(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<string | null> {
  const ctx = await resolveTeamContext(session);
  return ctx?.teamId ?? null;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamId = await resolveTeamId(session);
  if (!teamId) return NextResponse.json(EMPTY_PROFILE);

  const profile = await db.providerProfile.findUnique({
    where: { teamId },
    select: {
      notifyEmail: true,
      notifyWebhook: true,
      webhookUrl: true,
      apiKeyPrefix: true,
    },
  });

  return NextResponse.json(profile ?? EMPTY_PROFILE);
}

// ── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const teamId = await resolveTeamId(session);
  if (!teamId)
    return NextResponse.json({ error: "No team found" }, { status: 403 });

  const data = {
    ...(parsed.data.notifyEmail !== undefined && {
      notifyEmail: parsed.data.notifyEmail,
    }),
    ...(parsed.data.notifyWebhook !== undefined && {
      notifyWebhook: parsed.data.notifyWebhook,
    }),
    ...(parsed.data.webhookUrl !== undefined && {
      webhookUrl: parsed.data.webhookUrl || null,
    }),
  };

  const before = await db.providerProfile.findUnique({
    where: { teamId },
    select: {
      notifyEmail: true,
      notifyWebhook: true,
      webhookUrl: true,
      apiKeyPrefix: true,
    },
  });

  const profile = await db.providerProfile.upsert({
    where: { teamId },
    update: data,
    create: { teamId, ...data },
    select: {
      notifyEmail: true,
      notifyWebhook: true,
      webhookUrl: true,
      apiKeyPrefix: true,
    },
  });

  await writeAuditEvent({
    request: req,
    teamId,
    clerkUserId: session.clerkUserId,
    action: "provider.profile.update",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    beforeData: before ?? null,
    afterData: profile,
  });

  return NextResponse.json(profile);
}
