import { NextRequest, NextResponse } from "next/server";
import { getDemoNodeClient } from "@/lib/arcen-client";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json(
      { error: "wallet query param required" },
      { status: 400 },
    );
  }

  try {
    const client = getDemoNodeClient();
    const companyKeys = { wallet, id: `company-${wallet.slice(2, 10)}` };

    // Fetch flags and authoritative company detail through the Node SDK.
    const [scanFlag, exportFlag, apiFlag, aiFlag, companies] =
      await Promise.allSettled([
        client.checkEntitlement("scan", companyKeys),
        client.checkEntitlement("export-pdf", companyKeys),
        client.checkEntitlement("api-access", companyKeys),
        client.checkEntitlement("ai-summary", companyKeys),
        client.listCompanies({ limit: 25 }),
      ]);

    const toFlag = <
      T extends {
        key: string;
        enabled: boolean;
        reason: string;
        allocation: number | null;
        usage: number;
        exceeded: boolean;
      },
    >(
      result: PromiseSettledResult<T>,
    ) =>
      result.status === "fulfilled"
        ? {
            flag: result.value.key,
            value: result.value.enabled,
            reason: result.value.reason,
            allocation: result.value.allocation,
            usage: result.value.usage,
            exceeded: result.value.exceeded,
          }
        : null;

    type PlanInfo = {
      id: string;
      name: string;
      tier: string;
      price: string;
      billingInterval: number;
    };
    let plan: PlanInfo | null = null;
    let availablePlans: PlanInfo[] = [];

    if (companies.status === "fulfilled") {
      const matchedCompany = companies.value.data.find(
        (company) =>
          company.walletAddress?.toLowerCase() === wallet.toLowerCase() ||
          company.externalId === companyKeys.id,
      );

      if (matchedCompany) {
        const detail = await client.getCompany(matchedCompany.id).catch(() => null);
        const detailData = detail?.data as
          | {
              activePlan?: {
                id?: string;
                name?: string;
                tier?: string;
                price?: string | number;
                billingInterval?: number;
              } | null;
            }
          | undefined;

        if (detailData?.activePlan) {
          const activePlan = detailData.activePlan;
          plan = {
            id: String(activePlan.id ?? ""),
            name: String(activePlan.name ?? "Free"),
            tier: String(activePlan.tier ?? "free"),
            price: String(activePlan.price ?? "0"),
            billingInterval: Number(activePlan.billingInterval ?? 2_592_000),
          };
        }
      }
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}
