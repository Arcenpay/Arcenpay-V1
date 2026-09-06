import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requireFacilitatorAuth } from "../../../lib/auth/facilitator-auth.js";
import { resolveChainFamilyForPrisma } from "../../../lib/platform/chain-family.js";

const spendSchema = z.object({
  teamId: z.string().min(1),
  chainId: z.number().int().positive(),
  txHash: z.string().min(1),
  gasUsed: z.number().positive(),
  gasCostUsd: z.number().nonnegative(),
  walletAddress: z.string().min(1),
  txType: z.string().optional(),
});

export async function recordGasSpend(c: Context) {
  const authError = requireFacilitatorAuth(c.req.raw.headers);
  if (authError) return c.json({ error: authError.error }, authError.status as any as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = spendSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const { teamId, chainId, txHash, gasUsed, gasCostUsd, walletAddress } = parsed.data;

  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true },
  });
  if (!team) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  const record = await db.gasSpend.create({
    data: {
      teamId,
      chainId,
      chainFamily: resolveChainFamilyForPrisma(chainId),
      txHash,
      gasUsedWei: String(gasUsed),
      gasCostUsd,
      walletAddress,
    },
  });

  return c.json({ ok: true, id: record.id }, 201 as any);
}
