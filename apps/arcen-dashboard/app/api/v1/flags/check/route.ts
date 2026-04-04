import { NextRequest, NextResponse } from "next/server";
import { GET as getEntitlementCheck } from "@/app/api/v1/check/route";

export async function GET(req: NextRequest) {
  const canonicalResponse = await getEntitlementCheck(req);
  const body = (await canonicalResponse.json()) as
    | { error?: string }
    | {
        key: string;
        enabled: boolean;
        reason: string;
        allocation: number | null;
        usage: number;
        exceeded: boolean;
      };

  if (!canonicalResponse.ok) {
    return NextResponse.json(body, { status: canonicalResponse.status });
  }

  const result = body as {
    key: string;
    enabled: boolean;
    reason: string;
    allocation: number | null;
    usage: number;
    exceeded: boolean;
  };

  return NextResponse.json({
    data: {
      flag: result.key,
      value: result.enabled,
      reason: result.reason,
    },
    key: result.key,
    enabled: result.enabled,
    reason: result.reason,
    allocation: result.allocation,
    usage: result.usage,
    exceeded: result.exceeded,
  });
}
