import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";

const EMPTY_PROFILE = {
  providerName: null,
  website: null,
  contactEmail: null,
  notifyEmail: true,
  notifyWebhook: false,
  webhookUrl: null,
  apiKeyPrefix: null,
};

const UpdateSchema = z.object({
  providerName: z.string().max(120).optional().or(z.literal("")),
  website: z.string().url("Invalid website URL").optional().or(z.literal("")),
  contactEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  notifyEmail: z.boolean().optional(),
  notifyWebhook: z.boolean().optional(),
  webhookUrl: z
    .string()
    .url("Invalid webhook URL")
    .optional()
    .or(z.literal("")),
  webhookSigningSecret: z.string().min(16).max(256).optional(),
});

export async function getProfile(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const { team } = auth;
  const teamId = team.teamId;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const profile = await db.providerProfile.findUnique({
    where: {
      teamId_environmentId: {
        teamId,
        environmentId: activeEnvironment.id,
      },
    },
    select: {
      providerName: true,
      website: true,
      contactEmail: true,
      notifyEmail: true,
      notifyWebhook: true,
      webhookUrl: true,
      apiKeyPrefix: true,
    },
  });

  return c.json(profile ?? EMPTY_PROFILE);
}

export async function putProfile(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
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

  const d = parsed.data;
  const data: Record<string, unknown> = {};
  if (d.providerName !== undefined) data.providerName = d.providerName || null;
  if (d.website !== undefined) data.website = d.website || null;
  if (d.contactEmail !== undefined) data.contactEmail = d.contactEmail || null;
  if (d.notifyEmail !== undefined) data.notifyEmail = d.notifyEmail;
  if (d.notifyWebhook !== undefined) data.notifyWebhook = d.notifyWebhook;
  if (d.webhookUrl !== undefined) data.webhookUrl = d.webhookUrl || null;
  if (d.webhookSigningSecret !== undefined)
    data.webhookSigningSecret = d.webhookSigningSecret;

  const before = await db.providerProfile.findUnique({
    where: {
      teamId_environmentId: {
        teamId,
        environmentId: activeEnvironment.id,
      },
    },
    select: {
      providerName: true,
      website: true,
      contactEmail: true,
      notifyEmail: true,
      notifyWebhook: true,
      webhookUrl: true,
      apiKeyPrefix: true,
    },
  });

  const profile = await db.providerProfile.upsert({
    where: {
      teamId_environmentId: {
        teamId,
        environmentId: activeEnvironment.id,
      },
    },
    update: data,
    create: { teamId, environmentId: activeEnvironment.id, ...data },
    select: {
      providerName: true,
      website: true,
      contactEmail: true,
      notifyEmail: true,
      notifyWebhook: true,
      webhookUrl: true,
      apiKeyPrefix: true,
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.profile.update",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    beforeData: before ?? null,
    afterData: { ...profile },
  });

  return c.json(profile);
}
