import type { Context } from "hono";
import { clearSession } from "../../../lib/auth/auth.server.js";

export async function clearSessionHandler(c: Context) {
  await clearSession(c);
  return c.json({ ok: true });
}
