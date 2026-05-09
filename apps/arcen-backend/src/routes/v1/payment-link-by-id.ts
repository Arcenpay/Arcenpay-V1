import type { Context } from "hono";
import { z } from "zod";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import {
  getPaymentLinkById,
  updatePaymentLink,
} from "../../lib/payments/payment-links.js";
import { APP_URL } from "../../config.js";

const updateSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().nullable().optional(),
  recipientWallet: z.string().trim().optional(),
  successUrl: z.string().url().nullable().optional(),
  cancelUrl: z.string().url().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

function withCheckoutUrl<T extends { slug: string }>(paymentLink: T) {
  return {
    ...paymentLink,
    checkoutUrl: `${APP_URL}/pay/${paymentLink.slug}`,
  };
}

export async function GET(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const paymentLink = await getPaymentLinkById(auth.teamId, id);
  if (!paymentLink) {
    return c.json({ error: "Payment link not found" }, 404 as any);
  }
  return c.json({ paymentLink: withCheckoutUrl(paymentLink) });
}

export async function PATCH(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const body = await c.req.json() .catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  await updatePaymentLink({
    teamId: auth.teamId,
    id,
    status: parsed.data.status,
    name: parsed.data.name,
    description: parsed.data.description ?? undefined,
    recipientWallet: parsed.data.recipientWallet,
    successUrl: parsed.data.successUrl ?? undefined,
    cancelUrl: parsed.data.cancelUrl ?? undefined,
    expiresAt:
      parsed.data.expiresAt === null
        ? null
        : parsed.data.expiresAt
          ? new Date(parsed.data.expiresAt)
          : undefined,
  });

  const updated = await getPaymentLinkById(auth.teamId, id);
  if (!updated) {
    return c.json({ error: "Payment link not found" }, 404 as any);
  }
  return c.json({ paymentLink: withCheckoutUrl(updated) });
}
