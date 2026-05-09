import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

const NotificationEntrySchema = z.object({
  id: z.string().min(1),
  email: z.boolean(),
  webhook: z.boolean(),
});

const PutSchema = z.object({
  notifications: z.array(NotificationEntrySchema).min(1),
});

type NotificationEntry = z.infer<typeof NotificationEntrySchema>;

export async function getNotifications(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const teamId = auth.team.teamId;

  const profile = await db.providerProfile.findUnique({
    where: { teamId },
    select: { notificationPreferences: true },
  });

  const notifications = Array.isArray(profile?.notificationPreferences)
    ? (profile.notificationPreferences as NotificationEntry[])
    : [];

  return c.json({ notifications });
}

export async function putNotifications(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const { team } = auth;
  const teamId = team.teamId;
  const { notifications } = parsed.data;

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
    headers: c.req.raw.headers,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.notifications.update",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    afterData: { notifications, notifyEmail, notifyWebhook },
  });

  return c.json({ ok: true, notifications });
}
