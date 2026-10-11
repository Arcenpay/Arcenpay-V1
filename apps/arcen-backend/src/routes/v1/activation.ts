import { Hono } from "hono";
import { z } from "zod";
import { ActivationKeyService } from "../../services/activation-key.service.js";
import { getSessionFromCtx } from "../../lib/auth/auth.server.js";
import { db } from "../../db.js";
import { enforceRateLimit } from "../../lib/auth/rate-limit.js";
import { enforceTurnstileForAnonymous } from "../../lib/auth/turnstile.js";
import { resolveTrustedClientIp } from "../../lib/auth/client-ip.js";

const verifyKeySchema = z.object({
  key: z.string().min(1, "Key is required"),
});

const redeemKeySchema = z.object({
  key: z.string().min(1, "Key is required"),
  teamId: z.string().optional(),
});

export const activationRouter = new Hono()
  // Pre-flight verify key
  .post("/verify", async (c) => {
    const limited = await enforceRateLimit(c, {
      bucket: "activation-verify",
      limit: 20,
      windowMs: 5 * 60_000,
    });
    if (limited) return limited;

    const body = await c.req.json().catch(() => ({}));
    const parse = verifyKeySchema.safeParse(body);
    if (!parse.success) {
      return c.json({ ok: false, error: parse.error.errors[0]?.message || "Key is required", code: "BAD_REQUEST" }, 400 as any);
    }

    const challenge = await enforceTurnstileForAnonymous(c, body);
    if (challenge) return challenge;

    const result = await ActivationKeyService.verifyActivationKey(parse.data.key);
    return c.json({ ok: true, ...result });
  })
  // Redeem key
  .post("/redeem", async (c) => {
    const limited = await enforceRateLimit(c, {
      bucket: "activation-redeem",
      limit: 10,
      windowMs: 10 * 60_000,
    });
    if (limited) return limited;

    const body = await c.req.json().catch(() => ({}));
    const parse = redeemKeySchema.safeParse(body);
    if (!parse.success) {
      return c.json({ ok: false, error: parse.error.errors[0]?.message || "Invalid input", code: "BAD_REQUEST" }, 400 as any);
    }

    const challenge = await enforceTurnstileForAnonymous(c, body);
    if (challenge) return challenge;

    // SECURITY: redemption is scoped to the caller's OWN team. Accepting an
    // arbitrary body `teamId` let an unauthenticated caller attach an activation
    // key to any workspace. Both dashboard callers already send only `{ key }`
    // and rely on the session's current team.
    const session = await getSessionFromCtx(c);
    if (!session) {
      return c.json({ ok: false, error: "Authentication required", code: "UNAUTHORIZED" }, 401 as any);
    }

    const requestedTeamId = parse.data.teamId;
    if (requestedTeamId && requestedTeamId !== session.currentTeamId) {
      return c.json({ ok: false, error: "You do not have access to this team", code: "FORBIDDEN" }, 403 as any);
    }

    const teamId = session.currentTeamId;
    if (!teamId) {
      return c.json({ ok: false, error: "Team ID is required to redeem an activation key", code: "TEAM_REQUIRED" }, 400 as any);
    }

    // Audit context uses the proxy-validated client IP, not the raw
    // client-supplied `x-forwarded-for` chain (which any caller can forge).
    const ipAddress = resolveTrustedClientIp(c.req.raw.headers) ?? undefined;
    const userAgent = c.req.header("user-agent") || undefined;

    const result = await ActivationKeyService.redeemActivationKey({
      key: parse.data.key,
      teamId,
      userId: session?.userId,
      userEmail: session?.email || undefined,
      walletAddress: session?.walletAddress || undefined,
      ipAddress,
      userAgent,
    });

    if (!result.success) {
      return c.json({ ok: false, error: result.error, reason: result.reason, code: "REDEMPTION_FAILED" }, 400 as any);
    }

    return c.json({ ok: true, data: result });
  })
  // Current team activation status
  // SECURITY: scoped to the caller's OWN team. This previously honoured an
  // arbitrary `?teamId=` and returned that team's PLAINTEXT activation key to an
  // anonymous caller — an unauthenticated credential disclosure (activation keys
  // unlock PRO/PLUS tiers and platform billing). Unauthenticated access is now
  // refused, a team the session does not own is refused, and the redeemable
  // `key` itself is never echoed back.
  .get("/status", async (c) => {
    const session = await getSessionFromCtx(c);
    if (!session) {
      return c.json({ ok: false, error: "Authentication required", code: "UNAUTHORIZED" }, 401 as any);
    }

    const requestedTeamId = c.req.query("teamId");
    if (requestedTeamId && requestedTeamId !== session.currentTeamId) {
      return c.json({ ok: false, error: "You do not have access to this team", code: "FORBIDDEN" }, 403 as any);
    }

    const teamId = session.currentTeamId;
    if (!teamId) {
      return c.json({ ok: false, error: "Team ID is required", code: "TEAM_REQUIRED" }, 400 as any);
    }

    const status = await ActivationKeyService.getTeamActivationStatus(teamId);
    if (!status) {
      return c.json({ ok: false, error: "Team not found", code: "NOT_FOUND" }, 404 as any);
    }

    return c.json({ ok: true, data: status });
  });
