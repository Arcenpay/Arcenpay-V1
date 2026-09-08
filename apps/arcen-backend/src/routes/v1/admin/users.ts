import { Hono } from "hono";
import { requireAdminAuth } from "../../../middleware/auth.js";
import { db } from "../../../db.js";

export const adminUsersRouter = new Hono()
  // ── List all users ─────────────────────────────────────────────
  .get("/", requireAdminAuth(), async (c) => {
    const search = c.req.query("search") || "";
    const limit = parseInt(c.req.query("limit") || "100", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { walletAddress: { contains: search, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      db.user.findMany({
        where: where as any,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: { id: true, email: true, walletAddress: true, stellarWalletAddress: true, createdAt: true },
      }),
      db.user.count({ where: where as any }),
    ]);

    return c.json({ ok: true, users, total, limit, offset });
  })
  // ── List all teams ─────────────────────────────────────────────
  .get("/teams", requireAdminAuth(), async (c) => {
    const search = c.req.query("search") || "";
    const tier = c.req.query("tier") || "";
    const activated = c.req.query("activated") || "";
    const limit = parseInt(c.req.query("limit") || "100", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
      ];
    }
    if (tier) where.platformTier = tier;
    if (activated === "true") where.isPlatformActivated = true;
    if (activated === "false") where.isPlatformActivated = false;

    const [teams, total] = await Promise.all([
      db.team.findMany({
        where: where as any,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true, name: true, slug: true, platformTier: true,
          isPlatformActivated: true, allowPlatformBilling: true,
          createdAt: true,
          _count: { select: { members: true } },
        },
      }),
      db.team.count({ where: where as any }),
    ]);

    return c.json({ ok: true, teams, total, limit, offset });
  })
  // ── Team detail ────────────────────────────────────────────────
  .get("/teams/:id", requireAdminAuth(), async (c) => {
    const id = c.req.param("id");
    const team = await db.team.findUnique({
      where: { id },
      select: {
        id: true, name: true, slug: true, platformTier: true,
        isPlatformActivated: true, allowPlatformBilling: true,
        activationKeyId: true, profileData: true,
        createdAt: true, updatedAt: true,
        _count: { select: { members: true, environments: true } },
      },
    });
    if (!team) return c.json({ ok: false, error: "Team not found" }, 404 as any);
    return c.json({ ok: true, data: team });
  });
