// ============================================================
//  GET  /api/provider/webhooks  — return webhook config
//  PUT  /api/provider/webhooks  — save webhook URL + event subscriptions
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { requireTeamRoles, isErrorResponse } from "@/lib/api-auth";

const EventSubSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean(),
});

const UpdateSchema = z.object({
  webhookUrl: z
    .string()
    .url("Invalid webhook URL")
    .nullable()
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  eventSubscriptions: z.array(EventSubSchema).optional(),
});

export async function GET() {
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const { team } = auth;

  const profile = await db.providerProfile.findUnique({
    where: { teamId: team.teamId },
    select: {
      webhookUrl: true,
      webhookSigningSecret: true,
      notificationPreferences: true,
    },
  });

  if (!profile) {
    return NextResponse.json({
      webhookUrl: null,
      hasSecret: false,
      eventSubscriptions: [],
    });
  }

  // Parse stored event subscriptions from notificationPreferences JSON
  let eventSubscriptions: z.infer<typeof EventSubSchema>[] = [];
  try {
    const prefs = profile.notificationPreferences as unknown;
    if (Array.isArray(prefs)) {
      eventSubscriptions = prefs
        .filter((p): p is { id: string; webhook: boolean } =>
          typeof p === "object" && p !== null && "id" in p,
        )
        .map((p) => ({
          id: p.id,
          enabled: p.webhook === true,
        }));
    }
  } catch {
    // ignore parse errors
  }

  return NextResponse.json({
    webhookUrl: profile.webhookUrl ?? null,
    hasSecret: !!profile.webhookSigningSecret,
    eventSubscriptions,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { team } = auth;
  const teamId = team.teamId;
  const { webhookUrl, eventSubscriptions } = parsed.data;

  const updateData: Record<string, unknown> = {};
  if (webhookUrl !== undefined) updateData.webhookUrl = webhookUrl;

  // Derive notifyWebhook from event subscriptions
  if (eventSubscriptions !== undefined) {
    updateData.notifyWebhook = eventSubscriptions.some((e) => e.enabled);

    // Merge with existing notificationPreferences preserving email prefs
    const existing = await db.providerProfile.findUnique({
      where: { teamId },
      select: { notificationPreferences: true },
    });
    const existingPrefs = Array.isArray(existing?.notificationPreferences)
      ? (existing!.notificationPreferences as Array<Record<string, unknown>>)
      : [];

    const merged = existingPrefs.map((pref) => {
      const updated = eventSubscriptions.find((e) => e.id === pref.id);
      if (updated) {
        return { ...pref, webhook: updated.enabled };
      }
      return pref;
    });

    // Add any new event IDs not previously in prefs
    for (const sub of eventSubscriptions) {
      if (!merged.find((p) => p.id === sub.id)) {
        merged.push({ id: sub.id, email: false, webhook: sub.enabled });
      }
    }

    updateData.notificationPreferences = merged;
  }

  const before = await db.providerProfile.findUnique({
    where: { teamId },
    select: { webhookUrl: true, notifyWebhook: true },
  });

  const profile = await db.providerProfile.upsert({
    where: { teamId },
    update: updateData,
    create: { teamId, ...updateData },
    select: { webhookUrl: true, notifyWebhook: true },
  });

  await writeAuditEvent({
    request: req,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.webhook.update",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    beforeData: before ?? null,
    afterData: profile,
  });

  return NextResponse.json({ ok: true, webhookUrl: profile.webhookUrl });
}
