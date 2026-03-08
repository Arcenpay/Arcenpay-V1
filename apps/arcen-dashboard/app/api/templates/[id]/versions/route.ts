// ============================================================
//  Dashboard API — Template Version History
//  GET /api/templates/[id]/versions
//
//  Returns all versions of a billing template so the UI can
//  display version history and offer rollback / diff viewing.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";

type RouteParams = { id: string };

export async function GET(
  _request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  const auth = await requirePermission("templates:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;

  // Confirm the template belongs to this team
  const template = await db.billingTemplate.findFirst({
    where: { id, teamId: auth.team.teamId },
    select: { id: true, name: true, currentVersion: true, status: true },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
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

  // Build lightweight diff summary between adjacent versions
  // (full JSON diff is available client-side; here we just flag changed fields)
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

  return NextResponse.json({
    templateId: id,
    templateName: template.name,
    currentVersion: template.currentVersion,
    versions: versionsWithDiff,
  });
}
