// ============================================================
//  Dashboard API — Uninstall a Template
//  DELETE /api/templates/[id]/uninstall
//         ?env=DEVELOPMENT&chainId=11155111
//
//  Removes the TemplateInstall record for a given
//  environment + chain combination. Does NOT delete the
//  template itself or any of its versions.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

type RouteParams = { id: string };

const querySchema = z.object({
  env: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
  chainId: z.coerce.number().int().positive(),
});

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  const auth = await requirePermission("templates:install");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;

  const qs = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(qs);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { env, chainId } = parsed.data;

  // Verify the template belongs to this team
  const template = await db.billingTemplate.findFirst({
    where: { id, teamId: auth.team.teamId },
    select: { id: true, name: true },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
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
    return NextResponse.json(
      { error: "Template is not installed for this environment + chain" },
      { status: 404 },
    );
  }

  await db.templateInstall.delete({ where: { id: install.id } });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "template.uninstall",
    resourceType: "BillingTemplate",
    resourceId: id,
    metadata: { templateName: template.name, environmentMode: env, chainId },
  });

  return NextResponse.json({
    ok: true,
    templateId: id,
    environmentMode: env,
    chainId,
  });
}
