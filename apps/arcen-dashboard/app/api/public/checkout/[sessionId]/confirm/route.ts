import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  confirmCheckoutSessionPayment,
} from "@/lib/checkout-sessions";
import { normalizeTxHash } from "@/lib/onchain-payment-verification";

const bodySchema = z.object({
  txHash: z.string().trim().min(1),
  senderWallet: z.string().trim().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const txHash = normalizeTxHash(parsed.data.txHash);
  if (!txHash) {
    return NextResponse.json(
      { error: "txHash must be a valid transaction hash." },
      { status: 400 },
    );
  }

  const result = await confirmCheckoutSessionPayment({
    sessionId,
    txHash,
    senderWallet: parsed.data.senderWallet,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ checkoutSession: result.session, payment: result.payment ?? null });
}
