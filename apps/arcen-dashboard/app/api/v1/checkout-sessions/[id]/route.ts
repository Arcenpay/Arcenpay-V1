import { NextRequest, NextResponse } from "next/server";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import { getCheckoutSessionById } from "@/lib/checkout-sessions";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAnyAuth(request);
  if (isAnyAuthError(auth)) return auth;

  const { id } = await params;
  const checkoutSession = await getCheckoutSessionById(id, auth.teamId);
  if (!checkoutSession) {
    return NextResponse.json(
      { error: "Checkout session not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ checkoutSession });
}
