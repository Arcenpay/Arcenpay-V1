/**
 * GET/PUT /api/v1/agent/permissions — Agent config CRUD
 */

import type { Context } from "hono";
import { Prisma } from "../../generated/client/client.js";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";

export async function GET(c: Context) {
  try {
    const ctx = await requirePermission(c, "catalog:read");
    if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

    const { team } = ctx;
    const config = await db.arcenAgentConfig.findUnique({
      where: { teamId: team.teamId },
    });

    if (!config) {
      return c.json({
        data: {
          autoTopUp: { mode: "off", dailyLimit: "5.00", perTxnLimit: "1.00", threshold: "0.50" },
          dispatch: { enabled: false, providers: [], cooldownSeconds: 120, maxRetries: 3 },
          agentWalletAddress: "",
        },
      });
    }

    return c.json({
      data: {
        autoTopUp: config.autoTopUp,
        dispatch: config.dispatch,
        agentWalletAddress: config.agentWalletAddress || "",
      },
    });
  } catch (err: any) {
    console.error("[agent/permissions GET]", err);
    return c.json({ error: err.message || "Internal error" }, 500 as any);
  }
}

export async function PUT(c: Context) {
  try {
    const ctx = await requirePermission(c, "catalog:write");
    if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

    const { team } = ctx;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400 as any);
    }

    const data: Record<string, unknown> = {};

    if (body.autoTopUp) {
      data.autoTopUp = body.autoTopUp;
    }
    if (body.dispatch) {
      data.dispatch = body.dispatch;
    }
    if (typeof body.agentWalletAddress === "string" && body.agentWalletAddress) {
      data.agentWalletAddress = body.agentWalletAddress;
    }

    const existing = await db.arcenAgentConfig.findUnique({
      where: { teamId: team.teamId },
    });

    let config;
    if (existing) {
      config = await db.arcenAgentConfig.update({
        where: { teamId: team.teamId },
        data: data as any,
      });
    } else {
      config = await db.arcenAgentConfig.create({
        data: { teamId: team.teamId, ...data } as any,
      });
    }

    return c.json({
      data: {
        autoTopUp: config.autoTopUp,
        dispatch: config.dispatch,
        agentWalletAddress: config.agentWalletAddress || "",
      },
    });
  } catch (err: any) {
    console.error("[agent/permissions PUT]", err);
    return c.json({ error: err?.message || err?.toString() || "Internal server error" }, 500 as any);
  }
}
