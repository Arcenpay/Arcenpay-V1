// ============================================================
//  Dashboard API — Provider Notification Preferences
//  GET  /api/provider/notifications — load per-event prefs
//  PUT  /api/provider/notifications — save per-event prefs
//
//  Stores per-event notification settings server-side so they
//  persist across devices and sessions (not localStorage).
//  PRD §09 — Transactional Emails / Notification Settings
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";

const NotificationEntrySchema = z.object({
  id: z.string().min(1),
  email: z.boolean(),
  webhook: z.boolean(),
});

const PutSchema = z.object({
  notifications: z.array(NotificationEntrySchema).min(1),
});

type NotificationEntry = z.infer<typeof NotificationEntrySchema>;

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
  if (!teamId)
    return NextResponse.json({ notifications: [] });

  const profile = await db.providerProfile.findUnique({
    where: { teamId },
    select: { notificationPreferences: true },
  });

  const notifications = Array.isArray(profile?.notificationPreferences)
    ? (profile.notificationPreferences as NotificationEntry[])
    : [];

  return NextResponse.json({ notifications });
}

// ── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const teamId = await resolveTeamId(session);
  if (!teamId)
    return NextResponse.json({ error: "No team found" }, { status: 403 });

  const { notifications } = parsed.data;

  // Derive aggregate flags from per-event settings
  const notifyEmail = notifications.some((n) => n.email);
  const notifyWebhook = notifications.some((n) => n.webhook);

  await db.providerProfile.upsert({
    where: { teamId },
    update: {
      notificationPreferences: notifications,
      notifyEmail,
      notifyWebhook,
    },
    create: {
      teamId,
      notificationPreferences: notifications,
      notifyEmail,
      notifyWebhook,
    },
  });

  await writeAuditEvent({
    request,
    teamId,
    userId: session.clerkUserId,
    action: "provider.notifications.update",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    afterData: { notifications, notifyEmail, notifyWebhook },
  });

  return NextResponse.json({ ok: true, notifications });
}
