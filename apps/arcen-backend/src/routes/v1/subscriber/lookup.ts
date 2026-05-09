import type { Context } from "hono";
import { db } from "../../../db.js";
import { requireFacilitatorAuth } from "../../../lib/auth/facilitator-auth.js";

export async function lookupSubscriber(c: Context) {
  const authError = requireFacilitatorAuth(c.req.raw.headers);
  if (authError) return c.json({ error: authError.error }, authError.status as any as any as any);

  const wallet = c.req.query("wallet");

  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return c.json({ error: "Invalid wallet address" }, 400 as any);
  }

  const record = await db.subscriberEmail
    .findUnique({
      where: { walletAddress: wallet },
      select: { email: true, planId: true },
    })
    .catch(() => null);

  if (!record) {
    return c.json({ email: null }, 200 as any);
  }

  return c.json({ email: record.email, planId: record.planId });
}
