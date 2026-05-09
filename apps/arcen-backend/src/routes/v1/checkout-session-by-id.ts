import type { Context } from "hono";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import { getCheckoutSessionById } from "../../lib/payments/checkout-sessions.js";

export async function GET(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const checkoutSession = await getCheckoutSessionById(id, auth.teamId);
  if (!checkoutSession) {
    return c.json({ error: "Checkout session not found" }, 404 as any);
  }

  return c.json({ checkoutSession });
}
