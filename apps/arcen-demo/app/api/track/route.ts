import { NextRequest, NextResponse } from "next/server";
import { getArcenClient } from "@/lib/arcen-client";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name?: string;
      wallet?: string;
      traits?: Record<string, unknown>;
      idempotencyKey?: string;
    };
    if (!body.name || !body.wallet) {
      return NextResponse.json({ error: "Missing name or wallet" }, { status: 400 });
    }

    const client = getArcenClient();
    await client.track({
      name: body.name,
      company: { wallet: body.wallet, id: `company-${body.wallet.slice(2, 10)}` },
      traits: body.traits,
      idempotencyKey: body.idempotencyKey,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
