import type { Context } from "hono";
import { db } from "../../../db.js";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "../../../config.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

export async function getWebhookLog(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const { team } = auth;
  if (team) {
    const limitParam = Number(c.req.query("limit") || "50");
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(Math.trunc(limitParam), 200))
      : 50;

    const entries = await db.webhookDelivery.findMany({
      where: { teamId: team.teamId },
      orderBy: { deliveredAt: "desc" },
      take: limit,
    });

    if (entries.length > 0) {
      return c.json({
        configured: true,
        entries,
        log: entries,
        source: "database",
        degraded: false,
      });
    }
  }

  try {
    const limit = c.req.query("limit") || "50";

    const response = await fetch(
      `${FACILITATOR_URL}/api/webhooks/log?limit=${limit}&provider=${team?.walletAddress ?? ""}`,
      {
        headers: {
          "Content-Type": "application/json",
          ...(FACILITATOR_SECRET
            ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
            : {}),
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404 || response.status === 503) {
        return c.json({
          entries: [],
          degraded: true,
          message: "Webhook delivery log backend is temporarily unavailable.",
          source: "facilitator",
        });
      }
      throw new Error(`Facilitator returned ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const entries = Array.isArray(data.entries)
      ? data.entries
      : Array.isArray(data.log)
        ? data.log
        : [];

    return c.json({
      configured: data.configured !== false,
      entries,
      log: entries,
      degraded: data.degraded === true,
      message:
        typeof data.message === "string" ? data.message : undefined,
      source: "facilitator",
    });
  } catch (err) {
    console.error("[webhooks/log]", err);
    return c.json({
      entries: [],
      degraded: true,
      message: err instanceof Error ? err.message : "Webhook log unavailable.",
      source: "facilitator",
    });
  }
}
