import { NextResponse } from "next/server";
import { getCheckoutSessionById } from "@/lib/checkout-sessions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const checkoutSession = await getCheckoutSessionById(sessionId);
  if (!checkoutSession) {
    return NextResponse.json(
      { error: "Checkout session not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
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
            slug: checkoutSession.paymentLink.slug,
            kind: checkoutSession.paymentLink.kind,
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
