import type { Context } from "hono";
import { getSessionFromCtx } from "../../../lib/auth/auth.server.js";
import { db } from "../../../db.js";

export async function walletStatus(c: Context) {
  const session = await getSessionFromCtx(c);
  if (!session) {
    return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { walletAddress: true },
  });

  return c.json({ storedWallet: user?.walletAddress ?? null });
}
