import type { Context } from "hono";
import { z } from "zod";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import { db } from "../../db.js";
import { createCheckoutSession } from "../../lib/payments/checkout-sessions.js";
import { getPaymentLinkById } from "../../lib/payments/payment-links.js";
import { RUNTIME_CHAIN_ID } from "../../lib/platform/runtime-chain.js";
import { requireResolvedActiveEnvironment } from "../../lib/environments/workspace-environments.js";

const createSchema = z
  .object({
    paymentLinkId: z.string().trim().optional(),
    purpose: z.enum(["ADDON", "INVOICE", "CUSTOM"]).optional(),
    companyId: z.string().trim().optional(),
    catalogAddOnId: z.string().trim().optional(),
    invoiceId: z.string().trim().optional(),
    customerEmail: z.string().email().optional(),
    customerWallet: z.string().trim().optional(),
    customerName: z.string().trim().optional(),
    amount: z.coerce.number().positive().optional(),
    acceptedToken: z.string().trim().optional(),
    recipientWallet: z.string().trim().optional(),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.paymentLinkId) {
      if (!value.purpose || !value.amount || !value.acceptedToken || !value.recipientWallet) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Raw session creation requires purpose, amount, acceptedToken, and recipientWallet.",
        });
      }
    }
  });

export async function GET(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const activeEnvironment =
    auth.source === "session" && auth.sessionId
      ? await requireResolvedActiveEnvironment(
          {
            sessionId: auth.sessionId,
            activeEnvironmentId: auth.activeEnvironmentId ?? null,
          },
          auth.teamId,
        )
      : null;

  const checkoutSessions = await db.checkoutSession.findMany({
    where: {
      teamId: auth.teamId,
      ...(activeEnvironment ? { environmentId: activeEnvironment.id } : {}),
    },
    include: {
      paymentLink: {
        select: { id: true, name: true, slug: true, kind: true },
      },
      company: {
        select: { id: true, name: true, email: true, walletAddress: true },
      },
      catalogAddOn: {
        select: { id: true, name: true, code: true },
      },
      invoice: {
        select: { id: true, number: true, status: true },
      },
      payment: {
        select: { id: true, status: true, txHash: true, amount: true, currency: true },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });

  return c.json({ checkoutSessions });
}

export async function POST(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);



  const activeEnvironment =
    auth.source === "session" && auth.sessionId
      ? await requireResolvedActiveEnvironment(
          {
            sessionId: auth.sessionId,
            activeEnvironmentId: auth.activeEnvironmentId ?? null,
          },
          auth.teamId,
        )
      : null;

  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  if (parsed.data.paymentLinkId) {
    const paymentLink = await getPaymentLinkById(auth.teamId, parsed.data.paymentLinkId);
    if (!paymentLink) {
      return c.json({ error: "Payment link not found" }, 404 as any);
    }

    const session = await createCheckoutSession({
      teamId: auth.teamId,
      environmentId: paymentLink.environmentId ?? activeEnvironment?.id ?? null,
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
      successUrl:
        parsed.data.successUrl ?? paymentLink.successUrl ?? undefined,
      cancelUrl: parsed.data.cancelUrl ?? paymentLink.cancelUrl ?? undefined,
      expiresAt:
        parsed.data.expiresAt
          ? new Date(parsed.data.expiresAt)
          : paymentLink.expiresAt ?? undefined,
      metadata: {
        source: "payment_link",
        paymentLinkSlug: paymentLink.slug,
      },
    });
    return c.json({ checkoutSession: session }, 201 as any);
  }

  const session = await createCheckoutSession({
    teamId: auth.teamId,
    environmentId: activeEnvironment?.id ?? null,
    purpose: parsed.data.purpose!,
    companyId: parsed.data.companyId,
    catalogAddOnId: parsed.data.catalogAddOnId,
    invoiceId: parsed.data.invoiceId,
    customerEmail: parsed.data.customerEmail,
    customerWallet: parsed.data.customerWallet,
    customerName: parsed.data.customerName,
    amount: parsed.data.amount!,
    currency: "USDC",
    acceptedToken: parsed.data.acceptedToken!,
    chainId: activeEnvironment?.chainId ?? RUNTIME_CHAIN_ID,
    recipientWallet: parsed.data.recipientWallet!,
    successUrl: parsed.data.successUrl,
    cancelUrl: parsed.data.cancelUrl,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
    metadata: { source: "direct" },
  });

  return c.json({ checkoutSession: session }, 201 as any);
}
