import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getCheckoutSessionById,
  updateCheckoutSessionCustomerDetails,
} from "@/lib/checkout-sessions";

const patchSchema = z.object({
  customerEmail: z.string().email().optional().or(z.literal("")),
  customerWallet: z.string().trim().optional().or(z.literal("")),
  customerName: z.string().trim().optional().or(z.literal("")),
});

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const existing = await getCheckoutSessionById(sessionId);
  if (!existing) {
    return NextResponse.json(
      { error: "Checkout session not found" },
      { status: 404 },
    );
  }

  const checkoutSession = await updateCheckoutSessionCustomerDetails({
    sessionId,
    customerEmail: parsed.data.customerEmail || null,
    customerWallet: parsed.data.customerWallet || null,
    customerName: parsed.data.customerName || null,
  });

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
