/**
 * GET  /api/v1/feature-flags/:id/rules   — List flag targeting rules
 * POST /api/v1/feature-flags/:id/rules   — Add a targeting rule
 * PUT  /api/v1/feature-flags/:id/rules   — Replace all rules (bulk update)
 */

import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";
import { invalidateFlagCache } from "../../lib/entitlements/flag-cache.js";
import { Prisma } from "../../generated/client/client.js";

interface ConditionInput {
  criteriaType: string;
  operator: string;
  values?: unknown[];
  metricKey?: string;
  metricValue?: number;
  metricPeriod?: string;
  traitKey?: string;
  zktlsProviderId?: string;
}

interface RuleInput {
  priority: number;
  value: boolean;
  conditions: ConditionInput[];
}

function containsPlanCriteria(conditions: ConditionInput[] | undefined): boolean {
  return (conditions ?? []).some((condition) => condition.criteriaType === "base_plan");
}

function hasInvalidRulePayload(rules: RuleInput[] | undefined): boolean {
  return (rules ?? []).some((rule) => containsPlanCriteria(rule.conditions));
}

export async function GET(c: Context) {
  const ctx = await requirePermission(c, "catalog:read");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const id = c.req.param("id");
  const { team } = ctx;

  const flag = await db.catalogFeatureFlag.findFirst({
    where: { id, teamId: team.teamId },
    include: {
      rules: {
        orderBy: { priority: "asc" },
        include: { conditions: true },
      },
    },
  });

  if (!flag) return c.json({ error: "Flag not found" }, 404 as any);

  return c.json({ data: flag.rules });
}

export async function POST(c: Context) {
  const ctx = await requirePermission(c, "catalog:write");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const id = c.req.param("id");
  const { team } = ctx;

  const flag = await db.catalogFeatureFlag.findFirst({
    where: { id, teamId: team.teamId },
    select: { id: true },
  });

  if (!flag) return c.json({ error: "Flag not found" }, 404 as any);

  let body: RuleInput;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  // ── Rule validation ──────────────────────────────────────────
  if (body.priority !== undefined && (typeof body.priority !== "number" || body.priority < 0 || body.priority > 999)) {
    return c.json({ error: "priority must be between 0 and 999" }, 400 as any);
  }
  for (const cond of body.conditions ?? []) {
    if (cond.metricKey !== undefined && cond.metricKey.length > 256) {
      return c.json({ error: "metricKey too long" }, 400 as any);
    }
    if (cond.traitKey !== undefined && cond.traitKey.length > 256) {
      return c.json({ error: "traitKey too long" }, 400 as any);
    }
    if (cond.metricValue !== undefined && (!Number.isFinite(cond.metricValue) || cond.metricValue < 0)) {
      return c.json({ error: "metricValue must be a finite number >= 0" }, 400 as any);
    }
  }
  if (containsPlanCriteria(body.conditions)) {
    return c.json({
        error:
          "Base plan targeting is managed from Plan Catalog entitlements and cannot be created in Flags.",
      }, 400 as any);
  }

  const rule = await db.flagRule.create({
    data: {
      flagId: flag.id,
      priority: body.priority,
      value: body.value,
      source: "manual",
      conditions: {
        create: (body.conditions ?? []).map((c) => ({
          criteriaType: c.criteriaType,
          operator: c.operator,
          values: (c.values ?? []) as unknown as Prisma.InputJsonValue,
          metricKey: c.metricKey,
          metricValue: c.metricValue,
          metricPeriod: c.metricPeriod,
          traitKey: c.traitKey,
          zktlsProviderId: c.zktlsProviderId,
        })),
      },
    },
    include: { conditions: true },
  });

  invalidateFlagCache(`${team.teamId}:`);

  return c.json({ data: rule }, 201 as any);
}

export async function PUT(c: Context) {
  const ctx = await requirePermission(c, "catalog:write");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const id = c.req.param("id");
  const { team } = ctx;

  const flag = await db.catalogFeatureFlag.findFirst({
    where: { id, teamId: team.teamId },
    select: { id: true },
  });

  if (!flag) return c.json({ error: "Flag not found" }, 404 as any);

  let body: { rules: RuleInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  // ── Rules validation ─────────────────────────────────────────
  for (const rule of body.rules ?? []) {
    if (rule.priority !== undefined && (typeof rule.priority !== "number" || rule.priority < 0 || rule.priority > 999)) {
      return c.json({ error: "priority must be between 0 and 999" }, 400 as any);
    }
    for (const cond of rule.conditions ?? []) {
      if (cond.metricKey !== undefined && cond.metricKey.length > 256) {
        return c.json({ error: "metricKey too long" }, 400 as any);
      }
      if (cond.traitKey !== undefined && cond.traitKey.length > 256) {
        return c.json({ error: "traitKey too long" }, 400 as any);
      }
      if (cond.metricValue !== undefined && (!Number.isFinite(cond.metricValue) || cond.metricValue < 0)) {
        return c.json({ error: "metricValue must be a finite number >= 0" }, 400 as any);
      }
    }
  }
  if (hasInvalidRulePayload(body.rules)) {
    return c.json({
        error:
          "Base plan targeting is managed from Plan Catalog entitlements and cannot be edited in Flags.",
      }, 400 as any);
  }

  // Replace only editable manual rules. Plan-derived rows are preserved because
  // plan access is owned by Plan Catalog.
  await db.$transaction([
    db.flagRule.deleteMany({
      where: {
        flagId: flag.id,
        NOT: {
          source: "plan",
        },
      },
    }),
    ...body.rules.map((rule, i) =>
      db.flagRule.create({
        data: {
          flagId: flag.id,
          priority: rule.priority ?? i,
          value: rule.value,
          source: "manual",
          conditions: {
            create: (rule.conditions ?? []).map((c) => ({
              criteriaType: c.criteriaType,
              operator: c.operator,
              values: (c.values ?? []) as unknown as Prisma.InputJsonValue,
              metricKey: c.metricKey,
              metricValue: c.metricValue,
              metricPeriod: c.metricPeriod,
              traitKey: c.traitKey,
              zktlsProviderId: c.zktlsProviderId,
            })),
          },
        },
      }),
    ),
  ]);

  invalidateFlagCache(`${team.teamId}:`);

  return c.json({ ok: true });
}
