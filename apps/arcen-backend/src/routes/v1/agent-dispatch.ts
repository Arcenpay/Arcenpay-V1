/**
 * GET    /api/v1/agent/dispatch — List dispatch requests for the authenticated team
 * POST   /api/v1/agent/dispatch — Approve/deny a dispatch request
 *
 * Dispatch requests are top-up approval requests sent to messaging providers
 * when the agent needs funds but requires user approval.
 */

import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";

export async function GET(c: Context) {
  const ctx = await requirePermission(c, "catalog:read");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

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

  return c.json({
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

export async function POST(c: Context) {
  const ctx = await requirePermission(c, "catalog:write");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { team } = ctx;

  let body: { requestId: string; action: "approve" | "deny" };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  if (!body.requestId || !["approve", "deny"].includes(body.action)) {
    return c.json({ error: "requestId and action (approve|deny) are required" }, 400 as any);
  }

  const request = await db.arcenDispatchRequest.findFirst({
    where: { id: body.requestId, teamId: team.teamId },
  });

  if (!request) {
    return c.json({ error: "Dispatch request not found" }, 404 as any);
  }

  if (request.status !== "pending") {
    return c.json({ error: `Dispatch request is already ${request.status}` }, 409 as any);
  }

  const updated = await db.arcenDispatchRequest.update({
    where: { id: body.requestId },
    data: {
      status: body.action === "approve" ? "approved" : "denied",
      respondedAt: new Date(),
    },
  });

  return c.json({
    request: {
      id: updated.id,
      status: updated.status,
      respondedAt: updated.respondedAt?.toISOString(),
    },
  });
}
