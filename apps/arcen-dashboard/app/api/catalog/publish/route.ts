import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

const publishSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]),
});

export async function POST(request: NextRequest) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const environmentMode = parsed.data.environmentMode;
  const [plans, addOns, credits] = await Promise.all([
    db.catalogPlan.findMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
    }),
    db.catalogAddOn.findMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
    }),
    db.catalogCreditType.findMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
    }),
  ]);

  const now = new Date();

  await db.$transaction([
    db.catalogPlan.updateMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt: now },
    }),
    db.catalogAddOn.updateMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt: now },
    }),
    db.catalogCreditType.updateMany({
      where: { teamId: auth.team.teamId, environmentMode, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt: now },
    }),
  ]);

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    session: auth.session,
    action: "catalog.publish",
    resourceType: "Catalog",
    metadata: {
      environmentMode,
      plans: plans.length,
      addOns: addOns.length,
      credits: credits.length,
    },
  });

  return NextResponse.json({
    ok: true,
    environmentMode,
    published: {
      plans: plans.length,
      addOns: addOns.length,
      credits: credits.length,
    },
  });
}
