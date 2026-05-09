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

    return c.json({
      id: team.id,
      name: team.name,
      slug: team.slug,
      environmentMode: normalizeEnvironmentMode(team.environmentMode),
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

const PatchSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]),
});

async function updateTeamEnvironment(c: Context) {
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
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
          ok: false,
          error: "Invalid request",
          code: "BAD_REQUEST",
          details: parsed.error.flatten().fieldErrors,
        }, 400 as any);
    }

    const existing = await db.team.findUnique({
      where: { id: teamCtx.teamId },
      select: { id: true, environmentMode: true },
    });
    if (!existing) {
      return c.json({ ok: false, error: "Team not found", code: "NOT_FOUND" }, 404 as any);
    }

    const team = await db.team.update({
      where: { id: teamCtx.teamId },
      data: { environmentMode: normalizeEnvironmentMode(parsed.data.environmentMode) },
      select: { id: true, environmentMode: true },
    });

    await writeAuditEvent({
      headers: { get: (name: string) => c.req.header(name) ?? null },
      teamId: teamCtx.teamId,
      userId: teamCtx.userId,
      walletAddress: teamCtx.walletAddress,
      action: "team.environment.update",
      resourceType: "Team",
      resourceId: team.id,
      beforeData: existing,
      afterData: team,
    });

    return c.json({
      ...team,
      environmentMode: normalizeEnvironmentMode(team.environmentMode),
    });
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
