import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { TIER_FEATURES } from "../../../lib/catalog/tier-guard.js";
import type { PlatformTier } from "../../../generated/client/client.js";

export async function getSupportTickets(c: Context) {
  const auth = await requirePermission(c, "support:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const statusFilter = c.req.query("status");

  const tickets = await db.supportTicket.findMany({
    where: {
      teamId: auth.team.teamId,
      ...(statusFilter ? { status: statusFilter as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return c.json({ tickets });
}

const createSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  category: z.enum([
    "plan-editing",
    "billing",
    "technical",
    "account",
    "feature-request",
    "other",
  ]).optional(),
});

export async function createSupportTicket(c: Context) {
  const auth = await requirePermission(c, "support:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const team = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { platformTier: true },
  });
  if (!team) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  const tier = team.platformTier as PlatformTier;
  const features = TIER_FEATURES[tier];

  if (!features.prioritySupport && !features.dedicatedSupport) {
    return c.json({
        error: "Support tickets require PLUS or PRO tier",
        upgradeRequired: "PLUS",
        message: "Upgrade to PLUS for priority email support, or PRO for dedicated support with managed plan editing.",
      }, 403 as any);
  }

  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const priority = features.dedicatedSupport ? "HIGH" : "NORMAL";

  const ticket = await db.supportTicket.create({
    data: {
      teamId: auth.team.teamId,
      userId: auth.team.userId,
      subject: parsed.data.subject,
      body: parsed.data.body,
      category: parsed.data.category ?? null,
      priority: priority as never,
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "support.ticket.create",
    resourceType: "SupportTicket",
    resourceId: ticket.id,
    afterData: ticket,
  });

  return c.json({ ticket }, 201 as any);
}
