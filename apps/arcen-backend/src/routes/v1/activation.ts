import { Hono } from "hono";
import { z } from "zod";
import { ActivationKeyService } from "../../services/activation-key.service.js";
import { getSessionFromCtx } from "../../lib/auth/auth.server.js";
import { db } from "../../db.js";

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
    const body = await c.req.json().catch(() => ({}));
    const parse = verifyKeySchema.safeParse(body);
    if (!parse.success) {
      return c.json({ ok: false, error: parse.error.errors[0]?.message || "Key is required", code: "BAD_REQUEST" }, 400 as any);
    }

    const result = await ActivationKeyService.verifyActivationKey(parse.data.key);
    return c.json({ ok: true, ...result });
  })
  // Redeem key
  .post("/redeem", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parse = redeemKeySchema.safeParse(body);
    if (!parse.success) {
      return c.json({ ok: false, error: parse.error.errors[0]?.message || "Invalid input", code: "BAD_REQUEST" }, 400 as any);
    }

    const session = await getSessionFromCtx(c);
    const teamId = parse.data.teamId || session?.currentTeamId;

    if (!teamId) {
      return c.json({ ok: false, error: "Team ID is required to redeem an activation key", code: "TEAM_REQUIRED" }, 400 as any);
    }

    // Capture request context
    const ipAddress = c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || undefined;
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
  .get("/status", async (c) => {
    const session = await getSessionFromCtx(c);
    const queryTeamId = c.req.query("teamId");
    const teamId = queryTeamId || session?.currentTeamId;

    if (!teamId) {
      return c.json({ ok: false, error: "Team ID is required", code: "TEAM_REQUIRED" }, 400 as any);
    }

    const status = await ActivationKeyService.getTeamActivationStatus(teamId);
    if (!status) {
      return c.json({ ok: false, error: "Team not found", code: "NOT_FOUND" }, 404 as any);
    }

    return c.json({ ok: true, data: status });
  });
