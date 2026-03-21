/**
 * GET  /api/v1/feature-flags/:id/rules   — List flag targeting rules
 * POST /api/v1/feature-flags/:id/rules   — Add a targeting rule
 * PUT  /api/v1/feature-flags/:id/rules   — Replace all rules (bulk update)
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { invalidateFlagCache } from "@/lib/flag-cache";
import { Prisma } from "@/src/generated/prisma/client";

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requirePermission("catalog:read");
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await params;
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

  if (!flag) return NextResponse.json({ error: "Flag not found" }, { status: 404 });

  return NextResponse.json({ data: flag.rules });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requirePermission("catalog:write");
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await params;
  const { team } = ctx;

  const flag = await db.catalogFeatureFlag.findFirst({
    where: { id, teamId: team.teamId },
    select: { id: true },
  });

  if (!flag) return NextResponse.json({ error: "Flag not found" }, { status: 404 });

  let body: RuleInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Rule validation ──────────────────────────────────────────
  if (body.priority !== undefined && (typeof body.priority !== "number" || body.priority < 0 || body.priority > 999)) {
    return NextResponse.json({ error: "priority must be between 0 and 999" }, { status: 400 });
  }
  for (const c of body.conditions ?? []) {
    if (c.metricKey !== undefined && c.metricKey.length > 256) {
      return NextResponse.json({ error: "metricKey too long" }, { status: 400 });
    }
    if (c.traitKey !== undefined && c.traitKey.length > 256) {
      return NextResponse.json({ error: "traitKey too long" }, { status: 400 });
    }
    if (c.metricValue !== undefined && (!Number.isFinite(c.metricValue) || c.metricValue < 0)) {
      return NextResponse.json({ error: "metricValue must be a finite number >= 0" }, { status: 400 });
    }
  }

  const rule = await db.flagRule.create({
    data: {
      flagId: flag.id,
      priority: body.priority,
      value: body.value,
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

  return NextResponse.json({ data: rule }, { status: 201 });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requirePermission("catalog:write");
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await params;
  const { team } = ctx;

  const flag = await db.catalogFeatureFlag.findFirst({
    where: { id, teamId: team.teamId },
    select: { id: true },
  });

  if (!flag) return NextResponse.json({ error: "Flag not found" }, { status: 404 });

  let body: { rules: RuleInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Rules validation ─────────────────────────────────────────
  for (const rule of body.rules ?? []) {
    if (rule.priority !== undefined && (typeof rule.priority !== "number" || rule.priority < 0 || rule.priority > 999)) {
      return NextResponse.json({ error: "priority must be between 0 and 999" }, { status: 400 });
    }
    for (const c of rule.conditions ?? []) {
      if (c.metricKey !== undefined && c.metricKey.length > 256) {
        return NextResponse.json({ error: "metricKey too long" }, { status: 400 });
      }
      if (c.traitKey !== undefined && c.traitKey.length > 256) {
        return NextResponse.json({ error: "traitKey too long" }, { status: 400 });
      }
      if (c.metricValue !== undefined && (!Number.isFinite(c.metricValue) || c.metricValue < 0)) {
        return NextResponse.json({ error: "metricValue must be a finite number >= 0" }, { status: 400 });
      }
    }
  }

  // Delete existing rules and recreate (transactional replace)
  await db.$transaction([
    db.flagRule.deleteMany({ where: { flagId: flag.id } }),
    ...body.rules.map((rule, i) =>
      db.flagRule.create({
        data: {
          flagId: flag.id,
          priority: rule.priority ?? i,
          value: rule.value,
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

  return NextResponse.json({ ok: true });
}
