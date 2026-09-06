import type { Context } from "hono";
import { z } from "zod";
import {
  getPaymentLinkBySlug,
  toAgenticSpecification,
} from "../../../lib/payments/payment-links.js";
import { createCheckoutSession } from "../../../lib/payments/checkout-sessions.js";

const bodySchema = z.object({
  customerEmail: z.string().email().optional(),
  customerWallet: z.string().trim().optional(),
  customerName: z.string().trim().optional(),
  companyId: z.string().trim().optional(),
  isAgentic: z.boolean().optional(),
});

export async function getPublicPaymentLinkSpec(c: Context) {
  const slug = c.req.param("slug");
  const paymentLink = await getPaymentLinkBySlug(slug!);
  if (!paymentLink || paymentLink.status !== "ACTIVE") {
    return c.json({ error: "Payment link unavailable" }, 404 as any);
  }
  if (paymentLink.expiresAt && paymentLink.expiresAt.getTime() <= Date.now()) {
    return c.json({ error: "Payment link expired" }, 410 as any);
  }

  const origin = new URL(c.req.url).origin;
  const spec = toAgenticSpecification(paymentLink, origin);
  return c.json({ spec, paymentLink: spec });
}

export async function createPaymentLinkSession(c: Context) {
  const slug = c.req.param("slug");
  const paymentLink = await getPaymentLinkBySlug(slug!);
  if (!paymentLink || paymentLink.status !== "ACTIVE") {
    return c.json({ error: "Payment link unavailable" }, 404 as any);
  }
  if (paymentLink.expiresAt && paymentLink.expiresAt.getTime() <= Date.now()) {
    return c.json({ error: "Payment link expired" }, 410 as any);
  }

  const body = await c.req.json() .catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const isAgentic =
    parsed.data.isAgentic ||
    Boolean(
      paymentLink.metadata &&
        typeof paymentLink.metadata === "object" &&
        !Array.isArray(paymentLink.metadata) &&
        (paymentLink.metadata as Record<string, unknown>).isAgentic,
    );

  const checkoutSession = await createCheckoutSession({
    teamId: paymentLink.teamId,
    environmentId: paymentLink.environmentId ?? null,
    purpose: paymentLink.kind,
    paymentLinkId: paymentLink.id,
    companyId: parsed.data.companyId ?? paymentLink.companyId ?? undefined,
    catalogAddOnId: paymentLink.catalogAddOnId ?? undefined,
    invoiceId: paymentLink.invoiceId ?? undefined,
    customerEmail:
      parsed.data.customerEmail ??
      paymentLink.company?.email ??
      paymentLink.invoice?.customerEmail ??
      undefined,
    customerWallet:
      parsed.data.customerWallet ??
      paymentLink.company?.walletAddress ??
      paymentLink.invoice?.customerWallet ??
      undefined,
    customerName:
      parsed.data.customerName ?? paymentLink.company?.name ?? undefined,
    amount: Number(paymentLink.amount),
    currency: paymentLink.currency,
    acceptedToken: paymentLink.acceptedToken,
    chainId: paymentLink.chainId,
    recipientWallet: paymentLink.recipientWallet,
    successUrl: paymentLink.successUrl ?? undefined,
    cancelUrl: paymentLink.cancelUrl ?? undefined,
    expiresAt: paymentLink.expiresAt ?? undefined,
    metadata: {
      source: isAgentic ? "agentic_checkout" : "public_pay_page",
      isAgentic,
      paymentLinkSlug: paymentLink.slug,
    },
  });

  return c.json({ checkoutSession }, 201 as any);
}
