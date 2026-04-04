import { NextRequest, NextResponse } from "next/server";
import {
  getArcenClient,
  getDemoCompanyKeys,
  getDemoUserIdentity,
} from "@/lib/arcen-client";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      featureKey?: string;
      traits?: Record<string, unknown>;
      idempotencyKey?: string;
    };

    if (!body.featureKey) {
      return NextResponse.json(
        { error: "Missing featureKey" },
        { status: 400 },
      );
    }

    const client = getArcenClient();
    const company = getDemoCompanyKeys();
    const user = getDemoUserIdentity();

    const result = await client.consumeEntitlement({
      featureKey: body.featureKey,
      company,
      user: {
        id: user.id,
        wallet: user.wallet,
      },
      traits: body.traits,
      idempotencyKey: body.idempotencyKey,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to consume entitlement";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
