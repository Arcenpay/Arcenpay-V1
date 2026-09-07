import { db } from "../../db.js";
import { getChainLabel, getChainIdsForEnvironment, normalizeEnvironmentMode } from "../platform/default-chain.js";
import type { ClerkSession } from "../auth/auth.server.js";
import type { TeamRole } from "../auth/auth.js";
import type { EnvironmentMode } from "../../generated/client/client.js";

export type WorkspaceEnvironmentSummary = {
  id: string;
  name: string;
  mode: EnvironmentMode;
  chainId: number;
  chainLabel: string;
  isActive: boolean;
};

export function canManageEnvironment(role: TeamRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function isChainAllowedForMode(
  mode: EnvironmentMode,
  chainId: number,
): boolean {
  return getChainIdsForEnvironment(normalizeEnvironmentMode(mode)).includes(chainId);
}

export function toEnvironmentSummary(
  environment: {
    id: string;
    name: string;
    mode: EnvironmentMode;
    chainId: number;
  },
  activeEnvironmentId?: string | null,
): WorkspaceEnvironmentSummary {
  return {
    id: environment.id,
    name: environment.name,
    mode: environment.mode,
    chainId: environment.chainId,
    chainLabel: getChainLabel(environment.chainId),
    isActive: environment.id === activeEnvironmentId,
  };
}

export async function listEnvironmentSummaries(
  teamId: string,
  activeEnvironmentId?: string | null,
): Promise<WorkspaceEnvironmentSummary[]> {
  const environments = await db.workspaceEnvironment.findMany({
    where: { teamId },
    orderBy: [{ createdAt: "asc" }],
  });

  return environments.map((environment) =>
    toEnvironmentSummary(environment, activeEnvironmentId),
  );
}

export async function findResolvedActiveEnvironment(
  session: Pick<ClerkSession, "sessionId" | "activeEnvironmentId">,
  teamId: string,
) {
  const environments = await db.workspaceEnvironment.findMany({
    where: { teamId },
    orderBy: [{ createdAt: "asc" }],
    take: 2,
  });

  if (environments.length === 0) {
    // Auto-create default Development environment so workspace is immediately usable
    const defaultEnv = await db.workspaceEnvironment.create({
      data: {
        teamId,
        name: "Development",
        mode: "DEVELOPMENT",
        chainId: 84532,
        chainFamily: "EVM",
      },
    }).catch(() => null);

    if (defaultEnv) {
      await db.catalogConfig.create({
        data: {
          teamId,
          environmentId: defaultEnv.id,
          environmentMode: defaultEnv.mode,
        },
      }).catch(() => {});

      await db.authSession.update({
        where: { id: session.sessionId },
        data: { activeEnvironmentId: defaultEnv.id },
      }).catch(() => {});

      return defaultEnv;
    }

    return null;
  }

  const active =
    environments.find((environment) => environment.id === session.activeEnvironmentId) ??
    environments[0];

  if (active.id !== session.activeEnvironmentId) {
    await db.authSession.update({
      where: { id: session.sessionId },
      data: { activeEnvironmentId: active.id },
    }).catch(() => {});
  }

  return active;
}

export async function requireResolvedActiveEnvironment(
  session: Pick<ClerkSession, "sessionId" | "activeEnvironmentId">,
  teamId: string,
) {
  return findResolvedActiveEnvironment(session, teamId);
}
