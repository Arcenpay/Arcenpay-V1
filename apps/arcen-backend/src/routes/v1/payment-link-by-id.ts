import type { Context } from "hono";
import { z } from "zod";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import {
  getPaymentLinkById,
  updatePaymentLink,
} from "../../lib/payments/payment-links.js";
import { APP_URL } from "../../config.js";
import { deliverWebhook } from "../../lib/webhooks/deliver-webhook.js";

const updateSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().nullable().optional(),
  recipientWallet: z.string().trim().optional(),
  successUrl: z.string().url().nullable().optional(),
  cancelUrl: z.string().url().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
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
    metadata:
      parsed.data.metadata === undefined ? undefined : parsed.data.metadata,
  });

  const updated = await getPaymentLinkById(auth.teamId, id);
  if (!updated) {
    return c.json({ error: "Payment link not found" }, 404 as any);
  }

  deliverWebhook(auth.teamId, "payment_link.updated", {
    environmentId: updated.environmentId ?? null,
    paymentLinkId: updated.id,
    slug: updated.slug,
    checkoutUrl: `${APP_URL}/pay/${updated.slug}`,
    kind: updated.kind,
    status: updated.status,
    name: updated.name,
    description: updated.description ?? null,
    amount: updated.amount,
    currency: updated.currency,
    acceptedToken: updated.acceptedToken,
    recipientWallet: updated.recipientWallet,
    companyId: updated.companyId ?? null,
    catalogAddOnId: updated.catalogAddOnId ?? null,
    invoiceId: updated.invoiceId ?? null,
    successUrl: updated.successUrl ?? null,
    cancelUrl: updated.cancelUrl ?? null,
    expiresAt: updated.expiresAt?.toISOString() ?? null,
    metadata: updated.metadata ?? null,
  }).catch(() => {});

  return c.json({ paymentLink: withCheckoutUrl(updated) });
}
