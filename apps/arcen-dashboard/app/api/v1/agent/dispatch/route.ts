/**
 * GET    /api/v1/agent/dispatch — List dispatch requests for the authenticated team
 * POST   /api/v1/agent/dispatch — Approve/deny a dispatch request
 *
 * Dispatch requests are top-up approval requests sent to messaging providers
 * when the agent needs funds but requires user approval.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const ctx = await requirePermission("catalog:read");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;

  const requests = await db.arcenDispatchRequest.findMany({
    where: { teamId: team.teamId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      agentAddress: true,
      amount: true,
      reason: true,
      status: true,
      createdAt: true,
      respondedAt: true,
      provider: true,
      providerTarget: true,
    },
  });

  return NextResponse.json({
    requests: requests.map((r: typeof requests[number]) => ({
      id: r.id,
      agentAddress: r.agentAddress,
      amount: r.amount,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt?.toISOString() ?? null,
      provider: r.provider,
      providerTarget: r.providerTarget,
    })),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await requirePermission("catalog:write");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;

  let body: { requestId: string; action: "approve" | "deny" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.requestId || !["approve", "deny"].includes(body.action)) {
    return NextResponse.json(
      { error: "requestId and action (approve|deny) are required" },
      { status: 400 },
    );
  }

  const request = await db.arcenDispatchRequest.findFirst({
    where: { id: body.requestId, teamId: team.teamId },
  });

  if (!request) {
    return NextResponse.json(
      { error: "Dispatch request not found" },
      { status: 404 },
    );
  }

  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `Dispatch request is already ${request.status}` },
      { status: 409 },
    );
  }

  const updated = await db.arcenDispatchRequest.update({
    where: { id: body.requestId },
    data: {
      status: body.action === "approve" ? "approved" : "denied",
      respondedAt: new Date(),
    },
  });

  return NextResponse.json({
    request: {
      id: updated.id,
      status: updated.status,
      respondedAt: updated.respondedAt?.toISOString(),
    },
  });
}
