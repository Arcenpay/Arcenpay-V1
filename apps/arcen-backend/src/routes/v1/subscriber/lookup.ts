import type { Context } from "hono";
import { db } from "../../../db.js";
import { requireFacilitatorAuth } from "../../../lib/auth/facilitator-auth.js";
import { findScopedSubscriberEmail } from "../../../lib/billing/subscriber-emails.js";

export async function lookupSubscriber(c: Context) {
  const authError = requireFacilitatorAuth(c.req.raw.headers);
  if (authError) return c.json({ error: authError.error }, authError.status as any as any as any);

  const wallet = c.req.query("wallet");
  const teamId = c.req.query("teamId")?.trim() || null;
  const environmentId = c.req.query("environmentId")?.trim() || null;

  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return c.json({ error: "Invalid wallet address" }, 400 as any);
  }

  const record = teamId
    ? await findScopedSubscriberEmail({
        teamId,
        environmentId,
        walletAddress: wallet,
      }).catch(() => null)
    : await db.subscriberEmail
        .findFirst({
          where: {
            scopeKey: "legacy",
            walletAddress: wallet.toLowerCase(),
          },
          select: { email: true, planId: true },
          orderBy: { updatedAt: "desc" },
        })
        .catch(() => null);

  if (!record) {
    return c.json({ email: null }, 200 as any);
  }

  return c.json({ email: record.email, planId: record.planId });
}
