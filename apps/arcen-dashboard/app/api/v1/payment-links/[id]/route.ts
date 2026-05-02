import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import {
  getPaymentLinkById,
  updatePaymentLink,
} from "@/lib/payment-links";
import { APP_URL } from "@/lib/config";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAnyAuth(request);
  if (isAnyAuthError(auth)) return auth;

  const { id } = await params;
  const paymentLink = await getPaymentLinkById(auth.teamId, id);
  if (!paymentLink) {
    return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
  }
  return NextResponse.json({ paymentLink: withCheckoutUrl(paymentLink) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAnyAuth(request);
  if (isAnyAuthError(auth)) return auth;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
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
    return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
  }
  return NextResponse.json({ paymentLink: withCheckoutUrl(updated) });
}
