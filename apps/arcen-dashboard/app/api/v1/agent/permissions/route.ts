/**
 * GET  /api/v1/agent/permissions  — Get agent auto-topup & dispatch permissions
 * PUT  /api/v1/agent/permissions  — Update agent auto-topup & dispatch permissions
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/src/generated/prisma/client";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";

const DEFAULT_PERMISSIONS = {
  autoTopUp: {
    mode: "off",
    dailyLimit: "5.00",
    perTxnLimit: "1.00",
    threshold: "0.50",
  },
  dispatch: {
    enabled: false,
    providers: [] as Record<string, unknown>[],
    cooldownSeconds: 120,
    maxRetries: 3,
  },
};

export async function GET(_req: NextRequest) {
  const ctx = await requirePermission("catalog:read");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;

  const config = await db.arcenAgentConfig.findUnique({
    where: { teamId: team.teamId },
  });

  if (!config) {
    return NextResponse.json({ data: DEFAULT_PERMISSIONS });
  }

  return NextResponse.json({
    data: {
      autoTopUp: config.autoTopUp,
      dispatch: config.dispatch,
    },
  });
}

export async function PUT(req: NextRequest) {
  const ctx = await requirePermission("catalog:write");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const autoTopUp = (body.autoTopUp ?? DEFAULT_PERMISSIONS.autoTopUp) as unknown as Prisma.InputJsonValue;
  const dispatch = (body.dispatch ?? DEFAULT_PERMISSIONS.dispatch) as unknown as Prisma.InputJsonValue;

  const existing = await db.arcenAgentConfig.findUnique({
    where: { teamId: team.teamId },
  });

  let config;
  if (existing) {
    config = await db.arcenAgentConfig.update({
      where: { teamId: team.teamId },
      data: { autoTopUp, dispatch },
    });
  } else {
    config = await db.arcenAgentConfig.create({
      data: {
        teamId: team.teamId,
        autoTopUp,
        dispatch,
      },
    });
  }

  return NextResponse.json({
    data: {
      autoTopUp: config.autoTopUp,
      dispatch: config.dispatch,
    },
  });
}
