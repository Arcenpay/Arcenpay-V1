import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPaymentLinkBySlug } from "@/lib/payment-links";
import { createCheckoutSession } from "@/lib/checkout-sessions";

const bodySchema = z.object({
  customerEmail: z.string().email().optional(),
  customerWallet: z.string().trim().optional(),
  customerName: z.string().trim().optional(),
  companyId: z.string().trim().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const paymentLink = await getPaymentLinkBySlug(slug);
  if (!paymentLink || paymentLink.status !== "ACTIVE") {
    return NextResponse.json({ error: "Payment link unavailable" }, { status: 404 });
  }
  if (paymentLink.expiresAt && paymentLink.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Payment link expired" }, { status: 410 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const checkoutSession = await createCheckoutSession({
    teamId: paymentLink.teamId,
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
      source: "public_pay_page",
      paymentLinkSlug: paymentLink.slug,
    },
  });

  return NextResponse.json({ checkoutSession }, { status: 201 });
}
