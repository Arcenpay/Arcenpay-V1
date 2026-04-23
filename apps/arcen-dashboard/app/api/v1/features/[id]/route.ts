/**
 * DELETE /api/v1/features/[id]  — Delete a feature by id
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const teamId = auth.team.teamId;

  const { id } = await params;

  const flag = await db.catalogFeatureFlag.findFirst({
    where: { id, teamId },
    select: { id: true },
  });

  if (!flag) {
    return NextResponse.json({ error: "Feature not found" }, { status: 404 });
  }

  await db.catalogFeatureFlag.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
