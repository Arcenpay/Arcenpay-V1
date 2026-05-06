import { NextRequest, NextResponse } from "next/server";
import { getArcenClient } from "@/lib/arcen-client";

/**
 * GET /api/company?wallet=0x...
 *
 * Returns company data (plan, entitlements, flags) for a given wallet.
 */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "wallet query param required" }, { status: 400 });
  }

  try {
    const client = getArcenClient();
    const companyKeys = { wallet, id: `company-${wallet.slice(2, 10)}` };

    const [scanFlag, exportFlag, apiFlag] = await Promise.allSettled([
      client.checkEntitlement("scan", companyKeys),
      client.checkEntitlement("export-pdf", companyKeys),
      client.checkEntitlement("api-access", companyKeys),
    ]);

    const toFlag = <T extends { key: string; enabled: boolean; reason: string; allocation: number | null; usage: number; exceeded: boolean }>(
      result: PromiseSettledResult<T>,
    ) =>
      result.status === "fulfilled"
        ? { flag: result.value.key, value: result.value.enabled, reason: result.value.reason, allocation: result.value.allocation, usage: result.value.usage, exceeded: result.value.exceeded }
        : null;

    return NextResponse.json({
      companyKeys,
      usage: { scan: null },
      flags: {
        scan: toFlag(scanFlag),
        "export-pdf": toFlag(exportFlag),
        "api-access": toFlag(apiFlag),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
