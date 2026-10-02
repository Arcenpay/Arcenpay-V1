import type { Context } from "hono";
import { db } from "../../../db.js";
import { requireFacilitatorAuth } from "../../../lib/auth/facilitator-auth.js";
import {
  findScopedSubscriberEmail,
  normalizeSubscriberWallet,
} from "../../../lib/billing/subscriber-emails.js";

export async function lookupSubscriber(c: Context) {
  const authError = requireFacilitatorAuth(c.req.raw.headers);
  if (authError) return c.json({ error: authError.error }, authError.status as any as any as any);

  const wallet = c.req.query("wallet");
  const teamId = c.req.query("teamId")?.trim() || null;
  const environmentId = c.req.query("environmentId")?.trim() || null;

  // Accept any supported family (EVM/Stellar/Solana); the old 0x-only regex
  // rejected every non-EVM subscriber wallet.
  const normalizedWallet = normalizeSubscriberWallet(wallet);
  if (!normalizedWallet) {
    return c.json({ error: "Invalid wallet address" }, 400 as any);
  }

  const record = teamId
    ? await findScopedSubscriberEmail({
        teamId,
        environmentId,
        walletAddress: normalizedWallet,
      }).catch(() => null)
    : await db.subscriberEmail
        .findFirst({
          where: {
            scopeKey: "legacy",
            walletAddress: normalizedWallet,
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
