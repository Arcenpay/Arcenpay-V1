import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { resolveChainFamilyForPrisma } from "../../../lib/platform/chain-family.js";

const installSchema = z.object({
  version: z.coerce.number().int().positive().optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
  chainId: z.coerce.number().int().positive(),
});

export async function getTemplateInstalls(c: Context) {
  const auth = await requirePermission(c, "templates:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const installs = await db.templateInstall.findMany({
    where: { teamId: auth.team.teamId, templateId: id },
    orderBy: { updatedAt: "desc" },
  });

  return c.json({ installs });
}

export async function installTemplate(c: Context) {
  const auth = await requirePermission(c, "templates:install");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const body = await c.req.json() .catch(() => ({}));
  const parsed = installSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const template = await db.billingTemplate.findFirst({
    where: { id, teamId: auth.team.teamId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  if (!template) {
    return c.json({ error: "Template not found" }, 404 as any);
  }

  const targetVersion = parsed.data.version || template.versions[0]?.version;
  if (!targetVersion) {
    return c.json({ error: "Template has no version to install" }, 400 as any);
  }

  const installed = await db.templateInstall.upsert({
    where: {
      teamId_templateId_environmentMode_chainId: {
        teamId: auth.team.teamId,
        templateId: template.id,
        environmentMode: parsed.data.environmentMode,
        chainId: parsed.data.chainId,
      },
    },
    update: {
      installedVersion: targetVersion,
      status: "INSTALLED",
    },
    create: {
      teamId: auth.team.teamId,
      templateId: template.id,
      installedVersion: targetVersion,
      environmentMode: parsed.data.environmentMode,
      chainId: parsed.data.chainId,
      chainFamily: resolveChainFamilyForPrisma(parsed.data.chainId),
      status: "INSTALLED",
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "template.install",
    resourceType: "TemplateInstall",
    resourceId: installed.id,
    metadata: {
      templateId: template.id,
      version: targetVersion,
      environmentMode: parsed.data.environmentMode,
      chainId: parsed.data.chainId,
    },
  });

  return c.json({ install: installed }, 201 as any);
}
