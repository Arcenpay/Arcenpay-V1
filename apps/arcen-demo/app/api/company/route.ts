import { NextRequest, NextResponse } from "next/server";
import { getArcenClient } from "@/lib/arcen-client";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "wallet query param required" }, { status: 400 });
  }

  try {
    const client = getArcenClient();
    const companyKeys = { wallet, id: `company-${wallet.slice(2, 10)}` };

    // Fetch flags + component render (for plan info) in parallel
    const [scanFlag, exportFlag, apiFlag, aiFlag, renderData] = await Promise.allSettled([
      client.checkEntitlement("scan", companyKeys),
      client.checkEntitlement("export-pdf", companyKeys),
      client.checkEntitlement("api-access", companyKeys),
      client.checkEntitlement("ai-summary", companyKeys),
      // Get plan data from the component render endpoint
      fetch(`${process.env.ARCENPAY_BASE_URL ?? "http://localhost:3000"}/api/v1/components/${process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID ?? ""}/render`, {
        headers: { Authorization: `Bearer ${process.env.ARCENPAY_API_KEY}` },
      }).then((r) => r.json()).catch(() => null),
    ]);

    const toFlag = <T extends { key: string; enabled: boolean; reason: string; allocation: number | null; usage: number; exceeded: boolean }>(
      result: PromiseSettledResult<T>,
    ) =>
      result.status === "fulfilled"
        ? { flag: result.value.key, value: result.value.enabled, reason: result.value.reason, allocation: result.value.allocation, usage: result.value.usage, exceeded: result.value.exceeded }
        : null;

    // Extract plan info from render data
    type PlanInfo = { id: string; name: string; tier: string; price: string; billingInterval: number };
    let plan: PlanInfo | null = null;
    let availablePlans: PlanInfo[] = [];

    if (renderData.status === "fulfilled" && renderData.value?.data) {
      const d = renderData.value.data as Record<string, unknown>;
      const ap = d.activePlan as Record<string, unknown> | null;
      const plans = d.plans as Array<Record<string, unknown>> | undefined;

      if (ap) {
        plan = {
          id: String(ap.id ?? ""),
          name: String(ap.name ?? "Free"),
          tier: String(ap.tier ?? "free"),
          price: String(ap.price ?? "0"),
          billingInterval: Number(ap.billingInterval ?? 2592000),
        };
      }
      availablePlans = (plans ?? []).map((p) => ({
        id: String(p.id ?? ""),
        name: String(p.name ?? ""),
        tier: String(p.tier ?? "standard"),
        price: String(p.price ?? "0"),
        billingInterval: Number(p.billingInterval ?? 2592000),
      }));
    }

    return NextResponse.json({
      plan,
      availablePlans,
      flags: {
        scan: toFlag(scanFlag),
        "export-pdf": toFlag(exportFlag),
        "api-access": toFlag(apiFlag),
        "ai-summary": toFlag(aiFlag),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
