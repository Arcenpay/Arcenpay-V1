import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { getSessionFromCtx } from "../../../lib/auth/auth.server.js";
import { resolveTeamContext } from "../../../lib/auth/team-session.js";
import { db } from "../../../db.js";
import { slugify } from "../../../lib/auth/auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { normalizeEnvironmentMode } from "../../../lib/platform/default-chain.js";
import { removeMember } from "./members.js";
import { switchTeam } from "./switch.js";
import { inviteMember } from "./invite.js";
import { acceptInvite } from "./invite-accept.js";
import { listInvites, revokeInvite } from "./invites.js";
import {
  findResolvedActiveEnvironment,
  listEnvironmentSummaries,
  toEnvironmentSummary,
} from "../../../lib/environments/workspace-environments.js";

async function getTeam(c: Context) {
  try {
    const session = await getSessionFromCtx(c);
    if (!session) {
      return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
    }

    const teamCtx = await resolveTeamContext(session);
    if (!teamCtx) {
      return c.json({ ok: false, error: "No team found", code: "FORBIDDEN" }, 403 as any);
    }

    const team = await db.team.findUnique({
      where: { id: teamCtx.teamId },
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, walletAddress: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!team) {
      return c.json({ ok: false, error: "Team not found", code: "NOT_FOUND" }, 404 as any);
    }

    const members = team.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      email: m.user.email,
      walletAddress: m.user.walletAddress,
      joinedAt: m.createdAt,
    }));

    const activeEnvironment = await findResolvedActiveEnvironment(session, team.id);
    const environments = await listEnvironmentSummaries(
      team.id,
      activeEnvironment?.id ?? session.activeEnvironmentId,
    );

    return c.json({
      id: team.id,
      name: team.name,
      slug: team.slug,
      environmentMode: normalizeEnvironmentMode(
        activeEnvironment?.mode ?? team.environmentMode,
      ),
      activeEnvironment: activeEnvironment
        ? toEnvironmentSummary(activeEnvironment, activeEnvironment.id)
        : null,
      environments,
      createdAt: team.createdAt,
      members,
      myRole: teamCtx.teamRole,
    });
  } catch (err) {
    console.error("[api/team GET]", err);
    return c.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, 500 as any);
  }
}

const PutSchema = z.object({
  name: z.string().min(1).max(64),
});

async function updateTeam(c: Context) {
  try {
    const session = await getSessionFromCtx(c);
    if (!session) {
      return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
    }

    const teamCtx = await resolveTeamContext(session);
    if (!teamCtx) {
      return c.json({ ok: false, error: "No team found", code: "FORBIDDEN" }, 403 as any);
    }

    if (teamCtx.teamRole !== "OWNER" && teamCtx.teamRole !== "ADMIN") {
      return c.json({ ok: false, error: "Forbidden", code: "FORBIDDEN" }, 403 as any);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
          ok: false,
          error: "Invalid request",
          code: "BAD_REQUEST",
          details: parsed.error.flatten().fieldErrors,
        }, 400 as any);
    }

    const { name } = parsed.data;
    let slug = slugify(name);

    // Check slug collision (only if it changed)
    const existing = await db.team.findUnique({
      where: { id: teamCtx.teamId },
    });
    if (existing && slugify(existing.name) !== slug) {
      const clash = await db.team.findFirst({
        where: { slug, id: { not: teamCtx.teamId } },
      });
      if (clash) slug = `${slug}-${Date.now()}`;
    }

    const team = await db.team.update({
      where: { id: teamCtx.teamId },
      data: { name, slug },
    });

    await writeAuditEvent({
      headers: { get: (name: string) => c.req.header(name) ?? null },
      teamId: teamCtx.teamId,
      userId: teamCtx.userId,
      walletAddress: teamCtx.walletAddress,
      action: "team.update",
      resourceType: "Team",
      resourceId: team.id,
      beforeData: existing,
      afterData: { id: team.id, name: team.name, slug: team.slug },
    });

    return c.json({ id: team.id, name: team.name, slug: team.slug });
  } catch (err) {
    console.error("[api/team PUT]", err);
    return c.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, 500 as any);
  }
}

async function updateTeamEnvironment(c: Context) {
  try {
    const session = await getSessionFromCtx(c);
    if (!session) {
      return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
    }

    return c.json({
      ok: false,
      error: "Team-wide environment switching has been removed. Use /api/v1/environments/select instead.",
      code: "GONE",
    }, 410 as any);
  } catch (err) {
    console.error("[api/team PATCH]", err);
    return c.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, 500 as any);
  }
}

export const teamRoutes = new Hono()
  .get("/", getTeam)
  .put("/", updateTeam)
  .patch("/", updateTeamEnvironment)
  .delete("/members", removeMember)
  .post("/switch", switchTeam)
  .post("/invite", inviteMember)
  .post("/invite/accept", acceptInvite)
  .get("/invites", listInvites)
  .delete("/invites", revokeInvite);
