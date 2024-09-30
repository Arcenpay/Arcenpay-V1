import type { Context } from "hono";
import { generateNonce } from "../../../lib/auth/nonce.server.js";
import { authNonceProtect, arcjetNodeRequest } from "../../../lib/auth/arcjet.js";
import { getSessionFromCtx } from "../../../lib/auth/auth.server.js";

export async function getNonce(c: Context) {
  const session = await getSessionFromCtx(c);
  if (!session) {
    return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
  }

  const decision = await authNonceProtect.protect(arcjetNodeRequest(c.req.raw) as any);
  if (decision.isDenied()) {
    if (decision.reason.isBot()) {
      return c.json({ ok: false, error: "Forbidden", code: "FORBIDDEN" }, 403 as any);
    }
    return c.json({ ok: false, error: "Too many requests. Please try again later.", code: "RATE_LIMITED" }, 429 as any);
  }

  const nonce = await generateNonce();
  return c.json(nonce);
}
