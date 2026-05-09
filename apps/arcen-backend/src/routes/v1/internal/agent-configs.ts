import type { Context } from "hono";
import { db } from "../../../db.js";
import { FACILITATOR_SECRET } from "../../../config.js";

export async function getAgentConfigs(c: Context) {
  const auth = c.req.header("authorization");
  if (FACILITATOR_SECRET && auth !== `Bearer ${FACILITATOR_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401 as any);
  }

  const configs = await db.arcenAgentConfig.findMany({
    select: {
      teamId: true,
      autoTopUp: true,
      dispatch: true,
      agentWalletAddress: true,
    },
  });

  return c.json({
    configs: configs.map((c) => ({
      teamId: c.teamId,
      autoTopUp: c.autoTopUp,
      dispatch: c.dispatch,
      agentWalletAddress: c.agentWalletAddress,
    })),
  });
}
