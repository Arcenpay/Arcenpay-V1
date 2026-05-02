import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import { db } from "@/lib/db";
import { createCheckoutSession } from "@/lib/checkout-sessions";
import { getPaymentLinkById } from "@/lib/payment-links";
import { RUNTIME_CHAIN_ID } from "@/lib/runtime-chain";

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

export async function GET(request: NextRequest) {
  const auth = await requireAnyAuth(request);
  if (isAnyAuthError(auth)) return auth;

  const checkoutSessions = await db.checkoutSession.findMany({
    where: { teamId: auth.teamId },
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

  return NextResponse.json({ checkoutSessions });
}

export async function POST(request: NextRequest) {
  const auth = await requireAnyAuth(request);
  if (isAnyAuthError(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  if (parsed.data.paymentLinkId) {
    const paymentLink = await getPaymentLinkById(auth.teamId, parsed.data.paymentLinkId);
    if (!paymentLink) {
      return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    }

    const session = await createCheckoutSession({
      teamId: auth.teamId,
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
    return NextResponse.json({ checkoutSession: session }, { status: 201 });
  }

  const session = await createCheckoutSession({
    teamId: auth.teamId,
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
    chainId: RUNTIME_CHAIN_ID,
    recipientWallet: parsed.data.recipientWallet!,
    successUrl: parsed.data.successUrl,
    cancelUrl: parsed.data.cancelUrl,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
    metadata: { source: "direct" },
  });

  return NextResponse.json({ checkoutSession: session }, { status: 201 });
}
