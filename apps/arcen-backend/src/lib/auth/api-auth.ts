import type { Context } from "hono";
import { getSessionFromCtx, type ClerkSession } from "./auth.server.js";
import { resolveTeamContext, type TeamContext } from "./team-session.js";
import { hasPermission, type Permission } from "./rbac.js";
import type { TeamRole } from "./auth.js";

export type AuthorizedContext = {
  session: ClerkSession;
  team: TeamContext;
};

export type AuthError = { error: string; status: number };

export async function requirePermission(
  c: Context,
  permission: Permission,
): Promise<AuthorizedContext | AuthError> {
  const session = await getSessionFromCtx(c);
  if (!session) {
    return { error: "Unauthorized", status: 401 };
  }

  const team = await resolveTeamContext(session);
  if (!team) {
    return { error: "No team found", status: 403 };
  }

  if (!hasPermission(team.teamRole, permission)) {
    return { error: "Forbidden", status: 403 };
  }

  return { session, team };
}

export async function requireTeamRoles(
  c: Context,
  roles: TeamRole[],
): Promise<AuthorizedContext | AuthError> {
  const session = await getSessionFromCtx(c);
  if (!session) {
    return { error: "Unauthorized", status: 401 };
  }

  const team = await resolveTeamContext(session);
  if (!team) {
    return { error: "No team found", status: 403 };
  }

  if (!roles.includes(team.teamRole)) {
    return { error: "Forbidden", status: 403 };
  }

  return { session, team };
}

export function isErrorResponse(value: unknown): value is AuthError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    "status" in value
  );
}
