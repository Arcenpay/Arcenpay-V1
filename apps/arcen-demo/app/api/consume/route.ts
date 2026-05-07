import { NextRequest, NextResponse } from "next/server";
import { getArcenClient } from "@/lib/arcen-client";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { featureKey?: string; wallet?: string };
    if (!body.featureKey || !body.wallet) {
      return NextResponse.json({ error: "Missing featureKey or wallet" }, { status: 400 });
    }

    const client = getArcenClient();
    const result = await client.consumeEntitlement({
      featureKey: body.featureKey,
      company: { wallet: body.wallet, id: `company-${body.wallet.slice(2, 10)}` },
    });

    if (result.exceeded || !result.consumed) {
      return NextResponse.json(
        { error: `Usage limit reached for "${body.featureKey}"` },
        { status: 429 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
