import { Hono } from "hono";
import { z } from "zod";
import { requireAdminAuth } from "../../../middleware/auth.js";
import { db } from "../../../db.js";
import { isPlatformAdminEmail, EMAIL_FROM_ADMIN, RESEND_API_KEY } from "../../../config.js";
import { ActivationKeyService } from "../../../services/activation-key.service.js";
import { buildEnterpriseActivationEmailHtml } from "./activation-keys.js";
import { Resend } from "resend";

export const adminUsersRouter = new Hono()
  // ── List all users (with enriched activation & workspace status) ──
  .get("/", requireAdminAuth(), async (c) => {
    const search = (c.req.query("search") || "").trim();
    const status = c.req.query("status") || "all"; // "all" | "unactivated" | "activated"
    const limit = Math.min(200, parseInt(c.req.query("limit") || "100", 10));
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { walletAddress: { contains: search, mode: "insensitive" } },
        { stellarWalletAddress: { contains: search, mode: "insensitive" } },
        {
          teams: {
            some: {
              team: {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { slug: { contains: search, mode: "insensitive" } },
                ],
              },
            },
          },
        },
      ];
    }

    // Fetch users with primary team and session info
    const [rawUsers, total] = await Promise.all([
      db.user.findMany({
        where: where as any,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          email: true,
          emailVerified: true,
          walletAddress: true,
          stellarWalletAddress: true,
          createdAt: true,
          updatedAt: true,
          currentTeamId: true,
          authSessions: {
            orderBy: { lastSeenAt: "desc" },
            take: 1,
            select: { lastSeenAt: true },
          },
          teams: {
            select: {
              role: true,
              team: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  platformTier: true,
                  isPlatformActivated: true,
                  allowPlatformBilling: true,
                  activationKeyId: true,
                  activationKey: {
                    select: {
                      id: true,
                      key: true,
                      name: true,
                      tier: true,
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      db.user.count({ where: where as any }),
    ]);

    // Format and enrich each user
    const users = rawUsers.map((u) => {
      const isAdmin = isPlatformAdminEmail(u.email);
      const primaryMembership =
        u.teams.find((t) => t.team.id === u.currentTeamId) ?? u.teams[0] ?? null;
      const primaryTeam = primaryMembership?.team ?? null;
      const hasActivatedTeam = u.teams.some((t) => t.team.isPlatformActivated);
      const isActivated = isAdmin || hasActivatedTeam;
      const activationStatus = isAdmin
        ? "ADMIN"
        : hasActivatedTeam
          ? "ACTIVATED"
          : "PENDING_ACTIVATION";
      const lastSeenAt = u.authSessions[0]?.lastSeenAt ?? u.updatedAt ?? u.createdAt;

      return {
        id: u.id,
        email: u.email,
        emailVerified: u.emailVerified,
        walletAddress: u.walletAddress,
        stellarWalletAddress: u.stellarWalletAddress,
        createdAt: u.createdAt,
        lastSeenAt,
        isAdmin,
        isActivated,
        activationStatus,
        primaryTeam: primaryTeam
          ? {
              id: primaryTeam.id,
              name: primaryTeam.name,
              slug: primaryTeam.slug,
              platformTier: primaryTeam.platformTier,
              isPlatformActivated: primaryTeam.isPlatformActivated,
              allowPlatformBilling: primaryTeam.allowPlatformBilling,
              activationKeyId: primaryTeam.activationKeyId,
              activationKey: primaryTeam.activationKey,
              role: primaryMembership?.role ?? "MEMBER",
            }
          : null,
        teamsCount: u.teams.length,
      };
    });

    // Filter by activation status if specified
    const filteredUsers =
      status === "unactivated"
        ? users.filter((u) => !u.isActivated)
        : status === "activated"
          ? users.filter((u) => u.isActivated)
          : users;

    // Calculate platform counts
    const [allUsersCount, unactivatedTeamsCount] = await Promise.all([
      db.user.count(),
      db.team.count({ where: { isPlatformActivated: false } }),
    ]);

    return c.json({
      ok: true,
      users: filteredUsers,
      total,
      totalAll: allUsersCount,
      unactivatedCount: unactivatedTeamsCount,
      limit,
      offset,
    });
  })

  // ── List sign-in attempts / outsiders (from EmailAuthCode) ────────
  .get("/signin-attempts", requireAdminAuth(), async (c) => {
    const limit = Math.min(200, parseInt(c.req.query("limit") || "100", 10));
    const search = (c.req.query("search") || "").trim().toLowerCase();

    // Query recent auth codes
    const codes = await db.emailAuthCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        email: true,
        createdAt: true,
        expiresAt: true,
        usedAt: true,
        attemptCount: true,
      },
    });

    // Group by email to summarize outsider attempts
    const emailMap = new Map<
      string,
      {
        email: string;
        latestAttemptAt: Date;
        firstAttemptAt: Date;
        totalRequests: number;
        hasCompletedOtp: boolean;
        latestUsedAt: Date | null;
      }
    >();

    for (const code of codes) {
      const email = code.email.trim().toLowerCase();
      if (search && !email.includes(search)) continue;

      const existing = emailMap.get(email);
      if (!existing) {
        emailMap.set(email, {
          email,
          latestAttemptAt: code.createdAt,
          firstAttemptAt: code.createdAt,
          totalRequests: 1,
          hasCompletedOtp: Boolean(code.usedAt),
          latestUsedAt: code.usedAt,
        });
      } else {
        existing.totalRequests += 1;
        if (code.createdAt > existing.latestAttemptAt) {
          existing.latestAttemptAt = code.createdAt;
        }
        if (code.createdAt < existing.firstAttemptAt) {
          existing.firstAttemptAt = code.createdAt;
        }
        if (code.usedAt) {
          existing.hasCompletedOtp = true;
          if (!existing.latestUsedAt || code.usedAt > existing.latestUsedAt) {
            existing.latestUsedAt = code.usedAt;
          }
        }
      }
    }

    const aggregated = Array.from(emailMap.values()).slice(0, limit);

    // Cross-reference with User and Team tables
    const emails = aggregated.map((a) => a.email);
    const users = await db.user.findMany({
      where: { email: { in: emails } },
      select: {
        id: true,
        email: true,
        createdAt: true,
        teams: {
          select: {
            team: {
              select: {
                id: true,
                name: true,
                slug: true,
                platformTier: true,
                isPlatformActivated: true,
              },
            },
          },
        },
      },
    });

    const userByEmail = new Map(
      users.map((u) => [u.email?.toLowerCase() ?? "", u]),
    );

    const results = aggregated.map((item) => {
      const user = userByEmail.get(item.email);
      const primaryTeam = user?.teams[0]?.team ?? null;
      const isActivated =
        isPlatformAdminEmail(item.email) || (primaryTeam?.isPlatformActivated ?? false);

      let status: "REGISTERED_ACTIVE" | "REGISTERED_NEEDS_KEY" | "OTP_INCOMPLETE";
      if (user) {
        status = isActivated ? "REGISTERED_ACTIVE" : "REGISTERED_NEEDS_KEY";
      } else {
        status = "OTP_INCOMPLETE";
      }

      return {
        email: item.email,
        latestAttemptAt: item.latestAttemptAt,
        firstAttemptAt: item.firstAttemptAt,
        totalRequests: item.totalRequests,
        hasCompletedOtp: item.hasCompletedOtp,
        hasAccount: Boolean(user),
        userId: user?.id ?? null,
        isActivated,
        status,
        team: primaryTeam
          ? {
              id: primaryTeam.id,
              name: primaryTeam.name,
              slug: primaryTeam.slug,
              tier: primaryTeam.platformTier,
              isActivated: primaryTeam.isPlatformActivated,
            }
          : null,
      };
    });

    return c.json({
      ok: true,
      attempts: results,
      total: results.length,
      needsKeyCount: results.filter((r) => r.status === "REGISTERED_NEEDS_KEY").length,
      incompleteCount: results.filter((r) => r.status === "OTP_INCOMPLETE").length,
    });
  })

  // ── Quick activate user's workspace ───────────────────────────────
  .post("/:id/activate", requireAdminAuth(), async (c) => {
    const userId = c.req.param("id");
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { teams: { include: { team: true } } },
    });

    if (!user) {
      return c.json({ ok: false, error: "User not found" }, 404 as any);
    }

    const teamToActivate = user.currentTeamId
      ? user.teams.find((t) => t.teamId === user.currentTeamId)?.team
      : user.teams[0]?.team;

    if (!teamToActivate) {
      return c.json({ ok: false, error: "User has no workspace to activate" }, 400 as any);
    }

    const updated = await db.team.update({
      where: { id: teamToActivate.id },
      data: {
        isPlatformActivated: true,
        allowPlatformBilling: true,
      },
    });

    return c.json({
      ok: true,
      message: `Workspace "${updated.name}" activated successfully`,
      team: {
        id: updated.id,
        name: updated.name,
        isPlatformActivated: updated.isPlatformActivated,
      },
    });
  })

  // ── Send an activation key directly to a user/email from hello@arcenpay.com ──
  .post("/send-activation-key", requireAdminAuth(), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
      email: z.string().email("Valid email required"),
      tier: z.enum(["FREE", "PLUS", "PRO"]).default("PRO"),
      maxUses: z.number().int().positive().default(1),
      notes: z.string().optional(),
      customMessage: z.string().optional(),
    });

    const parse = schema.safeParse(body);
    if (!parse.success) {
      return c.json({ ok: false, error: parse.error.errors[0]?.message || "Invalid input" }, 400 as any);
    }

    const { email, tier, maxUses, notes, customMessage } = parse.data;

    // Create the key
    const createdKey = await ActivationKeyService.createActivationKey({
      name: `Direct invite for ${email}`,
      recipientEmail: email,
      tier,
      maxUses,
      notes: notes || undefined,
    });

    // Build the high-contrast enterprise email
    const emailHtml = buildEnterpriseActivationEmailHtml({
      key: createdKey.key,
      tier: createdKey.tier,
      maxUses: createdKey.maxUses,
      recipientEmail: email,
      notes: createdKey.notes,
      customMessage: customMessage || undefined,
    });

    // Dispatch from hello@arcenpay.com
    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: EMAIL_FROM_ADMIN || "hello@arcenpay.com",
      to: [email],
      subject: `Your ArcenPay ${tier} Platform Activation Key`,
      html: emailHtml,
    });

    if (error) {
      return c.json({
        ok: false,
        error: `Key created (${createdKey.key}) but email failed: ${error.message}`,
        key: createdKey,
      }, 500 as any);
    }

    return c.json({
      ok: true,
      message: `Activation key sent to ${email} from ${EMAIL_FROM_ADMIN || "hello@arcenpay.com"}`,
      key: createdKey,
    });
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
          id: true,
          name: true,
          slug: true,
          platformTier: true,
          isPlatformActivated: true,
          allowPlatformBilling: true,
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
        id: true,
        name: true,
        slug: true,
        platformTier: true,
        isPlatformActivated: true,
        allowPlatformBilling: true,
        activationKeyId: true,
        profileData: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true, environments: true } },
      },
    });
    if (!team) return c.json({ ok: false, error: "Team not found" }, 404 as any);
    return c.json({ ok: true, data: team });
  });
