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
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { requireTeamRoles, isErrorResponse } from "@/lib/api-auth";

const NotificationEntrySchema = z.object({
  id: z.string().min(1),
  email: z.boolean(),
  webhook: z.boolean(),
});

const PutSchema = z.object({
  notifications: z.array(NotificationEntrySchema).min(1),
});

type NotificationEntry = z.infer<typeof NotificationEntrySchema>;

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const teamId = auth.team.teamId;

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
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { team } = auth;
  const teamId = team.teamId;
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
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.notifications.update",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    afterData: { notifications, notifyEmail, notifyWebhook },
  });

  return NextResponse.json({ ok: true, notifications });
}
