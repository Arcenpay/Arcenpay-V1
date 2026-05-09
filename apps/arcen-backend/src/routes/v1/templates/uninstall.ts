import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

const querySchema = z.object({
  env: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
  chainId: z.coerce.number().int().positive(),
});

export async function uninstallTemplate(c: Context) {
  const auth = await requirePermission(c, "templates:install");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const { env, chainId } = parsed.data;

  const template = await db.billingTemplate.findFirst({
    where: { id, teamId: auth.team.teamId },
    select: { id: true, name: true },
  });

  if (!template) {
    return c.json({ error: "Template not found" }, 404 as any);
  }

  const install = await db.templateInstall.findFirst({
    where: {
      teamId: auth.team.teamId,
      templateId: id,
      environmentMode: env,
      chainId,
    },
  });

  if (!install) {
    return c.json({ error: "Template is not installed for this environment + chain" }, 404 as any);
  }

  await db.templateInstall.delete({ where: { id: install.id } });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "template.uninstall",
    resourceType: "BillingTemplate",
    resourceId: id,
    metadata: { templateName: template.name, environmentMode: env, chainId },
  });

  return c.json({
    ok: true,
    templateId: id,
    environmentMode: env,
    chainId,
  });
}
