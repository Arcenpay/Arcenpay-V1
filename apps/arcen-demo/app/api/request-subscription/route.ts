import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDemoCompanyKeys, getDemoNodeClient } from "@/lib/arcen-client";

const bodySchema = z.object({
  planId: z.union([z.string().trim().min(1), z.number().int().positive()]),
  paymentAccount: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  subscriberEmail: z.string().email().optional(),
});

/**
 * POST /api/request-subscription
 *
 * Demo-only provider backend endpoint that proxies a checkout activation
 * request to the ArcenPay dashboard API using the server-side API key.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  try {
    const result = await getDemoNodeClient().activateSubscription({
      planId: parsed.data.planId,
      paymentAccount: parsed.data.paymentAccount,
      subscriberEmail: parsed.data.subscriberEmail,
      company: getDemoCompanyKeys(),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to request subscription activation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
