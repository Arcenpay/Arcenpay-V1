import type { Context } from "hono";
import { z } from "zod";
import {
  confirmCheckoutSessionPayment,
} from "../../../lib/payments/checkout-sessions.js";
import { normalizeTxHash } from "../../../lib/payments/onchain-payment-verification.js";

const bodySchema = z.object({
  txHash: z.string().trim().min(1),
  senderWallet: z.string().trim().optional(),
});

export async function confirmCheckout(c: Context) {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json() .catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const txHash = normalizeTxHash(parsed.data.txHash);
  if (!txHash) {
    return c.json({ error: "txHash must be a valid transaction hash." }, 400 as any);
  }

  const result = await confirmCheckoutSessionPayment({
    sessionId,
    txHash,
    senderWallet: parsed.data.senderWallet,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, result.status as any);
  }

  return c.json({ checkoutSession: result.session, payment: result.payment ?? null });
}
