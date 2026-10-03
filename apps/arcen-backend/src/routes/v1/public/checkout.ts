import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import {
  getCheckoutSessionById,
  updateCheckoutSessionCustomerDetails,
} from "../../../lib/payments/checkout-sessions.js";

const patchSchema = z.object({
  customerEmail: z.string().email().optional().or(z.literal("")),
  customerWallet: z.string().trim().optional().or(z.literal("")),
  customerName: z.string().trim().optional().or(z.literal("")),
});

export async function getCheckout(c: Context) {
  const sessionId = c.req.param("sessionId");
  const checkoutSession = await getCheckoutSessionById(sessionId!);
  if (!checkoutSession) {
    return c.json({ error: "Checkout session not found" }, 404 as any);
  }

  if (
    checkoutSession.status === "PENDING" &&
    checkoutSession.expiresAt &&
    checkoutSession.expiresAt.getTime() <= Date.now()
  ) {
    await db.checkoutSession.update({
      where: { id: checkoutSession.id },
      data: { status: "EXPIRED" },
    });
    checkoutSession.status = "EXPIRED";
  }

  return c.json({
    checkoutSession: {
      id: checkoutSession.id,
      status: checkoutSession.status,
      purpose: checkoutSession.purpose,
      customerEmail: checkoutSession.customerEmail,
      customerWallet: checkoutSession.customerWallet,
      customerName: checkoutSession.customerName,
      currency: checkoutSession.currency,
      amount: checkoutSession.amount,
      acceptedToken: checkoutSession.acceptedToken,
      chainId: checkoutSession.chainId,
      chainFamily: checkoutSession.chainFamily,
      recipientWallet: checkoutSession.recipientWallet,
      txHash: checkoutSession.txHash,
      verificationError: checkoutSession.verificationError,
      successUrl: checkoutSession.successUrl,
      cancelUrl: checkoutSession.cancelUrl,
      expiresAt: checkoutSession.expiresAt,
      paidAt: checkoutSession.paidAt,
      paymentLink: checkoutSession.paymentLink
        ? {
            id: checkoutSession.paymentLink.id,
            name: checkoutSession.paymentLink.name,
            description: checkoutSession.paymentLink.description,
            slug: checkoutSession.paymentLink.slug,
            kind: checkoutSession.paymentLink.kind,
            metadata: checkoutSession.paymentLink.metadata ?? null,
            company: checkoutSession.paymentLink.company
              ? {
                  id: checkoutSession.paymentLink.company.id,
                  name: checkoutSession.paymentLink.company.name,
                  email: checkoutSession.paymentLink.company.email,
                  walletAddress: checkoutSession.paymentLink.company.walletAddress,
                  logoUrl: checkoutSession.paymentLink.company.logoUrl,
                }
              : null,
          }
        : null,
      catalogAddOn: checkoutSession.catalogAddOn
        ? {
            id: checkoutSession.catalogAddOn.id,
            name: checkoutSession.catalogAddOn.name,
            description: checkoutSession.catalogAddOn.description,
          }
        : null,
      invoice: checkoutSession.invoice
        ? {
            id: checkoutSession.invoice.id,
            number: checkoutSession.invoice.number,
            status: checkoutSession.invoice.status,
          }
        : null,
    },
  });
}

export async function updateCheckout(c: Context) {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json() .catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const existing = await getCheckoutSessionById(sessionId!);
  if (!existing) {
    return c.json({ error: "Checkout session not found" }, 404 as any);
  }

  const checkoutSession = await updateCheckoutSessionCustomerDetails({
    sessionId: sessionId!,
    customerEmail: parsed.data.customerEmail || null,
    customerWallet: parsed.data.customerWallet || null,
    customerName: parsed.data.customerName || null,
  });

  return c.json({
    checkoutSession: {
      id: checkoutSession.id,
      status: checkoutSession.status,
      purpose: checkoutSession.purpose,
      customerEmail: checkoutSession.customerEmail,
      customerWallet: checkoutSession.customerWallet,
      customerName: checkoutSession.customerName,
      currency: checkoutSession.currency,
      amount: checkoutSession.amount,
      acceptedToken: checkoutSession.acceptedToken,
      chainId: checkoutSession.chainId,
      chainFamily: checkoutSession.chainFamily,
      recipientWallet: checkoutSession.recipientWallet,
      txHash: checkoutSession.txHash,
      verificationError: checkoutSession.verificationError,
      successUrl: checkoutSession.successUrl,
      cancelUrl: checkoutSession.cancelUrl,
      expiresAt: checkoutSession.expiresAt,
      paidAt: checkoutSession.paidAt,
      paymentLink: checkoutSession.paymentLink
        ? {
            id: checkoutSession.paymentLink.id,
            name: checkoutSession.paymentLink.name,
            description: checkoutSession.paymentLink.description,
            slug: checkoutSession.paymentLink.slug,
            kind: checkoutSession.paymentLink.kind,
            metadata: checkoutSession.paymentLink.metadata ?? null,
            company: checkoutSession.paymentLink.company
              ? {
                  id: checkoutSession.paymentLink.company.id,
                  name: checkoutSession.paymentLink.company.name,
                  email: checkoutSession.paymentLink.company.email,
                  walletAddress: checkoutSession.paymentLink.company.walletAddress,
                  logoUrl: checkoutSession.paymentLink.company.logoUrl,
                }
              : null,
          }
        : null,
      catalogAddOn: checkoutSession.catalogAddOn
        ? {
            id: checkoutSession.catalogAddOn.id,
            name: checkoutSession.catalogAddOn.name,
            description: checkoutSession.catalogAddOn.description,
          }
        : null,
      invoice: checkoutSession.invoice
        ? {
            id: checkoutSession.invoice.id,
            number: checkoutSession.invoice.number,
            status: checkoutSession.invoice.status,
          }
        : null,
    },
  });
}
