import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import {
  requireTeamRoles,
  isErrorResponse,
} from "../../../lib/auth/api-auth.js";

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
    .refine(
      (url) => url.startsWith("https://"),
      "Webhook URL must use HTTPS (http:// is not allowed)",
    )
    .nullable()
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  eventSubscriptions: z.array(EventSubSchema).optional(),
});

export async function getWebhookConfig(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth))
    return c.json({ ok: false, error: auth.error }, auth.status as any as any);

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
    return c.json({
      webhookUrl: null,
      hasSecret: false,
      eventSubscriptions: [],
    });
  }

  let eventSubscriptions: z.infer<typeof EventSubSchema>[] = [];
  try {
    const prefs = profile.notificationPreferences as unknown;
    if (Array.isArray(prefs)) {
      eventSubscriptions = prefs
        .filter(
          (p): p is { id: string; webhook: boolean } =>
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

  return c.json({
    webhookUrl: profile.webhookUrl ?? null,
    hasSecret: !!profile.webhookSigningSecret,
    eventSubscriptions,
  });
}

export async function putWebhookConfig(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth))
    return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400 as any,
    );
  }

  const { team } = auth;
  const teamId = team.teamId;
  const { webhookUrl, eventSubscriptions } = parsed.data;
  const existingProfile = await db.providerProfile.findUnique({
    where: { teamId },
    select: {
      webhookSigningSecret: true,
      notificationPreferences: true,
    },
  });

  // Block saving a URL without a signing secret
  if (webhookUrl && !existingProfile?.webhookSigningSecret) {
    return c.json(
      {
        error:
          "Generate a webhook signing secret before setting a webhook URL.",
      },
      400 as any,
    );
  }

  if (
    eventSubscriptions?.some((subscription) => subscription.enabled) &&
    !existingProfile?.webhookSigningSecret
  ) {
    return c.json(
      {
        error:
          "Generate a webhook signing secret before enabling webhook events.",
      },
      400 as any,
    );
  }

  const updateData: Record<string, unknown> = {};
  if (webhookUrl !== undefined) updateData.webhookUrl = webhookUrl;

  if (eventSubscriptions !== undefined) {
    updateData.notifyWebhook = eventSubscriptions.some((e) => e.enabled);

    const existingPrefs = Array.isArray(
      existingProfile?.notificationPreferences,
    )
      ? (existingProfile.notificationPreferences as Array<
          Record<string, unknown>
        >)
      : [];

    const merged = existingPrefs.map((pref) => {
      const updated = eventSubscriptions.find((e) => e.id === pref.id);
      if (updated) {
        return { ...pref, webhook: updated.enabled };
      }
      return pref;
    });

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
    headers: c.req.raw.headers,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.webhook.update",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    beforeData: before ?? null,
    afterData: profile,
  });

  return c.json({ ok: true, webhookUrl: profile.webhookUrl });
}
