/**
 * DELETE /api/v1/features/[id]  — Delete a feature by id
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";

async function requireTeamId(): Promise<string | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await resolveTeamContext(session);
  if (!ctx) {
    return NextResponse.json({ error: "No team found" }, { status: 403 });
  }
  return ctx.teamId;
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireTeamId();
  if (result instanceof NextResponse) return result;
  const teamId = result;

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
