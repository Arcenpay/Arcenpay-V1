import type { Context } from "hono";
import { resolveSession } from "../../../middleware/auth.js";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "../../../config.js";

export async function getActiveProofs(c: Context) {
  const session = await resolveSession(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401 as any);
  }

  if (!session.currentTeamId) {
    return c.json({ error: "No active team selected" }, 400 as any);
  }

  try {
    const upstream = await fetch(`${FACILITATOR_URL}/api/proofs/active`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(FACILITATOR_SECRET
          ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
          : {}),
      },
    });

    if (!upstream.ok) {
      return c.json({
        count: 0,
        jobs: [],
        degraded: true,
        message: `Facilitator returned ${upstream.status}.`,
      });
    }

    const payload = await upstream.json() as { count?: number; jobs?: unknown };
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    return c.json({
      count: Number(payload.count) || jobs.length,
      jobs,
      degraded: false,
    });
  } catch (err) {
    console.error("[proofs/active]", err);
    return c.json({
      count: 0,
      jobs: [],
      degraded: true,
      message: err instanceof Error ? err.message : "Active proof jobs unavailable.",
    });
  }
}
