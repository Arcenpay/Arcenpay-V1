import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import {
  requireTeamRoles,
  isErrorResponse,
} from "../../../lib/auth/api-auth.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";
import {
  CANONICAL_WEBHOOK_EVENTS,
  CANONICAL_WEBHOOK_EVENT_IDS,
} from "../../../lib/webhooks/webhook-events.js";

const EventSubSchema = z.object({
  id: z.string().refine(
    (value) => CANONICAL_WEBHOOK_EVENT_IDS.includes(value),
    "Unsupported webhook event",
  ),
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
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const profile = await db.providerProfile.findUnique({
    where: {
      teamId_environmentId: {
        teamId: team.teamId,
        environmentId: activeEnvironment.id,
      },
    },
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

  const prefs = Array.isArray(profile.notificationPreferences)
    ? (profile.notificationPreferences as Array<Record<string, unknown>>)
    : [];
  const eventSubscriptions = CANONICAL_WEBHOOK_EVENTS.map((event) => {
    const pref = prefs.find((item) => item.id === event.id);
    return {
      ...event,
      enabled: pref?.webhook === true,
    };
  });

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
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }
  const { webhookUrl, eventSubscriptions } = parsed.data;
  const existingProfile = await db.providerProfile.findUnique({
    where: {
      teamId_environmentId: {
        teamId,
        environmentId: activeEnvironment.id,
      },
    },
    select: {
      webhookUrl: true,
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

  if (
    eventSubscriptions?.some((subscription) => subscription.enabled) &&
    !webhookUrl &&
    !existingProfile?.webhookUrl
  ) {
    return c.json(
      {
        error:
          "Enter a webhook URL before enabling webhook events.",
      },
      400 as any,
    );
  }

  if (
    webhookUrl &&
    eventSubscriptions !== undefined &&
    !eventSubscriptions.some((subscription) => subscription.enabled)
  ) {
    return c.json(
      {
        error:
          "Select at least one webhook event before saving the endpoint.",
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
    const merged = CANONICAL_WEBHOOK_EVENTS.map((event) => {
      const existingPref =
        existingPrefs.find((pref) => pref.id === event.id) ?? {};
      const updated = eventSubscriptions.find((sub) => sub.id === event.id);
      return {
        id: event.id,
        email: existingPref.email === true,
        webhook: updated?.enabled === true,
      };
    });

    updateData.notificationPreferences = merged;
  }

  const before = await db.providerProfile.findUnique({
    where: {
      teamId_environmentId: {
        teamId,
        environmentId: activeEnvironment.id,
      },
    },
    select: { webhookUrl: true, notifyWebhook: true },
  });

  const profile = await db.providerProfile.upsert({
    where: {
      teamId_environmentId: {
        teamId,
        environmentId: activeEnvironment.id,
      },
    },
    update: updateData,
    create: {
      teamId,
      environmentId: activeEnvironment.id,
      ...updateData,
    },
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
