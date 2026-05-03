/**
 * GET/PUT /api/v1/agent/permissions — Agent config CRUD
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/src/generated/prisma/client";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest) {
  try {
    const ctx = await requirePermission("catalog:read");
    if (isErrorResponse(ctx)) return ctx;

    const { team } = ctx;
    const config = await db.arcenAgentConfig.findUnique({
      where: { teamId: team.teamId },
    });

    if (!config) {
      return NextResponse.json({
        data: {
          autoTopUp: { mode: "off", dailyLimit: "5.00", perTxnLimit: "1.00", threshold: "0.50" },
          dispatch: { enabled: false, providers: [], cooldownSeconds: 120, maxRetries: 3 },
          agentWalletAddress: "",
        },
      });
    }

    return NextResponse.json({
      data: {
        autoTopUp: config.autoTopUp,
        dispatch: config.dispatch,
        agentWalletAddress: config.agentWalletAddress || "",
      },
    });
  } catch (err: any) {
    console.error("[agent/permissions GET]", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requirePermission("catalog:write");
    if (isErrorResponse(ctx)) return ctx;

    const { team } = ctx;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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

    return NextResponse.json({
      data: {
        autoTopUp: config.autoTopUp,
        dispatch: config.dispatch,
        agentWalletAddress: config.agentWalletAddress || "",
      },
    });
  } catch (err: any) {
    console.error("[agent/permissions PUT]", err);
    return NextResponse.json(
      { error: err?.message || err?.toString() || "Internal server error" },
      { status: 500 },
    );
  }
}
