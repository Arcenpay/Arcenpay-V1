import type { Context } from "hono";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";

export async function getTemplateVersions(c: Context) {
  const auth = await requirePermission(c, "templates:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const template = await db.billingTemplate.findFirst({
    where: { id, teamId: auth.team.teamId },
    select: { id: true, name: true, currentVersion: true, status: true },
  });

  if (!template) {
    return c.json({ error: "Template not found" }, 404 as any);
  }

  const versions = await db.billingTemplateVersion.findMany({
    where: { templateId: id },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      createdAt: true,
      schemaJson: true,
      compatibility: true,
    },
  });

  const versionsWithDiff = versions.map((v, idx) => {
    const prev = versions[idx + 1];
    let changedFields: string[] | null = null;
    if (prev) {
      const currSchema = v.schemaJson as Record<string, unknown>;
      const prevSchema = prev.schemaJson as Record<string, unknown>;
      changedFields = Object.keys({ ...currSchema, ...prevSchema }).filter(
        (k) =>
          JSON.stringify(currSchema[k]) !== JSON.stringify(prevSchema[k]),
      );
    }
    return {
      ...v,
      isCurrent: v.version === template.currentVersion,
      changedFields,
    };
  });

  return c.json({
    templateId: id,
    templateName: template.name,
    currentVersion: template.currentVersion,
    versions: versionsWithDiff,
  });
}
