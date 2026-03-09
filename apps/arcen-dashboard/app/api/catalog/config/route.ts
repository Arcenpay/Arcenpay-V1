import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

const envModeSchema = z.enum(["DEVELOPMENT", "PRODUCTION"]);

const querySchema = z.object({
  environmentMode: envModeSchema.optional(),
});

const updateSchema = z.object({
  environmentMode: envModeSchema.optional(),
  initialPlan: z.string().min(1).max(64),
  fallbackPlan: z.string().min(1).max(64).nullable(),
  showBillingPeriodToggle: z.boolean(),
  freePlanPriceDisplay: z.boolean(),
  hideCredits: z.boolean(),
  yearlyDiscountDisplay: z.boolean(),
  showFeatureDescriptions: z.boolean(),
  showHardLimits: z.boolean(),
  upgradeImmediately: z.boolean(),
  downgradeImmediately: z.boolean(),
  preventDowngradeOverLimit: z.boolean(),
  disallowSelfServiceDowngrade: z.boolean(),
});

export async function GET(request: NextRequest) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const team = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { environmentMode: true },
  });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const environmentMode = parsed.data.environmentMode || team.environmentMode;

  const config = await db.catalogConfig.upsert({
    where: {
      teamId_environmentMode: {
        teamId: auth.team.teamId,
        environmentMode,
      },
    },
    update: {},
    create: {
      teamId: auth.team.teamId,
      environmentMode,
    },
  });

  return NextResponse.json({ config });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const team = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { environmentMode: true },
  });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const {
    environmentMode = team.environmentMode,
    initialPlan,
    fallbackPlan,
    showBillingPeriodToggle,
    freePlanPriceDisplay,
    hideCredits,
    yearlyDiscountDisplay,
    showFeatureDescriptions,
    showHardLimits,
    upgradeImmediately,
    downgradeImmediately,
    preventDowngradeOverLimit,
    disallowSelfServiceDowngrade,
  } = parsed.data;

  const existing = await db.catalogConfig.findUnique({
    where: {
      teamId_environmentMode: {
        teamId: auth.team.teamId,
        environmentMode,
      },
    },
  });

  const config = await db.catalogConfig.upsert({
    where: {
      teamId_environmentMode: {
        teamId: auth.team.teamId,
        environmentMode,
      },
    },
    update: {
      initialPlan,
      fallbackPlan,
      showBillingPeriodToggle,
      freePlanPriceDisplay,
      hideCredits,
      yearlyDiscountDisplay,
      showFeatureDescriptions,
      showHardLimits,
      upgradeImmediately,
      downgradeImmediately,
      preventDowngradeOverLimit,
      disallowSelfServiceDowngrade,
    },
    create: {
      teamId: auth.team.teamId,
      environmentMode,
      initialPlan,
      fallbackPlan,
      showBillingPeriodToggle,
      freePlanPriceDisplay,
      hideCredits,
      yearlyDiscountDisplay,
      showFeatureDescriptions,
      showHardLimits,
      upgradeImmediately,
      downgradeImmediately,
      preventDowngradeOverLimit,
      disallowSelfServiceDowngrade,
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.config.update",
    resourceType: "CatalogConfig",
    resourceId: config.id,
    beforeData: existing,
    afterData: config,
  });

  return NextResponse.json({ config });
}
