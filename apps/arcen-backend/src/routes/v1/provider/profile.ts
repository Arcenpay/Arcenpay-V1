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
  legalName: null,
  billingEmail: null,
  supportEmail: null,
  supportPhone: null,
  supportUrl: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  taxId: null,
  gstin: null,
  notifyEmail: true,
  notifyWebhook: false,
  webhookUrl: null,
  apiKeyPrefix: null,
};

const UpdateSchema = z.object({
  providerName: z.string().max(120).optional().or(z.literal("")),
  website: z.string().url("Invalid website URL").optional().or(z.literal("")),
  contactEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  legalName: z.string().max(160).optional().or(z.literal("")),
  billingEmail: z.string().email("Invalid billing email").optional().or(z.literal("")),
  supportEmail: z.string().email("Invalid support email").optional().or(z.literal("")),
  supportPhone: z.string().max(40).optional().or(z.literal("")),
  supportUrl: z.string().url("Invalid support URL").optional().or(z.literal("")),
  addressLine1: z.string().max(200).optional().or(z.literal("")),
  addressLine2: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(120).optional().or(z.literal("")),
  state: z.string().max(120).optional().or(z.literal("")),
  postalCode: z.string().max(40).optional().or(z.literal("")),
  country: z.string().max(2).optional().or(z.literal("")),
  taxId: z.string().max(64).optional().or(z.literal("")),
  gstin: z.string().max(32).optional().or(z.literal("")),
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
      legalName: true,
      billingEmail: true,
      supportEmail: true,
      supportPhone: true,
      supportUrl: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      taxId: true,
      gstin: true,
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
  if (d.legalName !== undefined) data.legalName = d.legalName || null;
  if (d.billingEmail !== undefined) data.billingEmail = d.billingEmail || null;
  if (d.supportEmail !== undefined) data.supportEmail = d.supportEmail || null;
  if (d.supportPhone !== undefined) data.supportPhone = d.supportPhone || null;
  if (d.supportUrl !== undefined) data.supportUrl = d.supportUrl || null;
  if (d.addressLine1 !== undefined) data.addressLine1 = d.addressLine1 || null;
  if (d.addressLine2 !== undefined) data.addressLine2 = d.addressLine2 || null;
  if (d.city !== undefined) data.city = d.city || null;
  if (d.state !== undefined) data.state = d.state || null;
  if (d.postalCode !== undefined) data.postalCode = d.postalCode || null;
  if (d.country !== undefined) data.country = d.country ? d.country.toUpperCase() : null;
  if (d.taxId !== undefined) data.taxId = d.taxId || null;
  if (d.gstin !== undefined) data.gstin = d.gstin ? d.gstin.toUpperCase() : null;
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
      legalName: true,
      billingEmail: true,
      supportEmail: true,
      supportPhone: true,
      supportUrl: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      taxId: true,
      gstin: true,
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
      legalName: true,
      billingEmail: true,
      supportEmail: true,
      supportPhone: true,
      supportUrl: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      taxId: true,
      gstin: true,
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
