import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { toPrismaJson } from "../../../utils/prisma-json.js";
import { getTemplateVersions } from "./versions.js";
import { getTemplateInstalls, installTemplate } from "./install.js";
import { uninstallTemplate } from "./uninstall.js";

const createSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9\-]+$/),
  description: z.string().optional(),
  schemaJson: z.record(z.unknown()),
  reactBlocks: z.array(z.record(z.unknown())),
  styleTokens: z.record(z.unknown()).default({}),
  compatibility: z.record(z.unknown()).default({
    environments: ["DEVELOPMENT", "PRODUCTION"],
    chains: [11155111, 84532, 8453, 5042002],
    tokens: ["USDC"],
  }),
});

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
});

async function getTemplates(c: Context) {
  const auth = await requirePermission(c, "templates:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const templates = await db.billingTemplate.findMany({
    where: { teamId: auth.team.teamId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
      },
      installs: {
        where: { status: "INSTALLED" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return c.json({ templates });
}

async function createTemplate(c: Context) {
  const auth = await requirePermission(c, "templates:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const data = parsed.data;

  const template = await db.billingTemplate.create({
    data: {
      teamId: auth.team.teamId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      status: "DRAFT",
      currentVersion: 1,
      versions: {
        create: {
          version: 1,
          schemaJson: toPrismaJson(data.schemaJson),
          reactBlocks: toPrismaJson(data.reactBlocks),
          styleTokens: toPrismaJson(data.styleTokens),
          compatibility: toPrismaJson(data.compatibility),
        },
      },
    },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
      },
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "template.create",
    resourceType: "BillingTemplate",
    resourceId: template.id,
    afterData: template,
  });

  return c.json({ template }, 201 as any);
}

async function updateTemplate(c: Context) {
  const auth = await requirePermission(c, "templates:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const existing = await db.billingTemplate.findFirst({
    where: { id: parsed.data.id, teamId: auth.team.teamId },
  });
  if (!existing) {
    return c.json({ error: "Template not found" }, 404 as any);
  }

  const updated = await db.billingTemplate.update({
    where: { id: existing.id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.status === "PUBLISHED" && {
        currentVersion: existing.currentVersion,
      }),
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "template.status.update",
    resourceType: "BillingTemplate",
    resourceId: updated.id,
    beforeData: existing,
    afterData: updated,
  });

  return c.json({ template: updated });
}

export const templatesRoutes = new Hono()
  .get("/", getTemplates)
  .post("/", createTemplate)
  .put("/", updateTemplate)
  .get("/:id/versions", getTemplateVersions)
  .get("/:id/install", getTemplateInstalls)
  .post("/:id/install", installTemplate)
  .delete("/:id/uninstall", uninstallTemplate);
