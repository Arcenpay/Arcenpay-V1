import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { listAddOnGrantCompanies } from "@/lib/addon-grants";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;
  const grants = await listAddOnGrantCompanies(auth.team.teamId, id);
  return NextResponse.json({ grants });
}
