import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

const installSchema = z.object({
  version: z.coerce.number().int().positive().optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
  chainId: z.coerce.number().int().positive(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Params) {
  const auth = await requirePermission("templates:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;
  const installs = await db.templateInstall.findMany({
    where: { teamId: auth.team.teamId, templateId: id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ installs });
}

export async function POST(request: NextRequest, context: Params) {
  const auth = await requirePermission("templates:install");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = installSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const template = await db.billingTemplate.findFirst({
    where: { id, teamId: auth.team.teamId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const targetVersion = parsed.data.version || template.versions[0]?.version;
  if (!targetVersion) {
    return NextResponse.json(
      { error: "Template has no version to install" },
      { status: 400 },
    );
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
      status: "INSTALLED",
    },
  });

  await writeAuditEvent({
    request,
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

  return NextResponse.json({ install: installed }, { status: 201 });
}
