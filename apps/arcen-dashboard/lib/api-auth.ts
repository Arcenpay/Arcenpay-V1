import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "@/lib/auth.server";
import { resolveTeamContext, type TeamContext } from "@/lib/team-session";
import { hasPermission, type Permission } from "@/lib/rbac";

export type AuthorizedContext = {
  session: SessionPayload;
  team: TeamContext;
};

export async function requirePermission(
  permission: Permission,
): Promise<AuthorizedContext | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const team = await resolveTeamContext(session);
  if (!team) {
    return NextResponse.json({ error: "No team found" }, { status: 403 });
  }

  if (!hasPermission(team.teamRole, permission)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { session, team };
}

export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
