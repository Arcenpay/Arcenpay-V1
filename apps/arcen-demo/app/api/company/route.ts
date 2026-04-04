import { NextResponse } from "next/server";
import {
  ensureDemoIdentity,
  getArcenClient,
  getDemoCompanyKeys,
} from "@/lib/arcen-client";

/**
 * GET /api/company
 *
 * Returns the current demo company's data (plan, entitlements, flags).
 */
export async function GET() {
  try {
    const client = getArcenClient();
    const companyKeys = getDemoCompanyKeys();
    await ensureDemoIdentity();

    const [scanFlag, exportFlag, apiFlag] = await Promise.allSettled([
      client.checkEntitlement("scan", companyKeys),
      client.checkEntitlement("export-pdf", companyKeys),
      client.checkEntitlement("api-access", companyKeys),
    ]);

    const toDemoFlag = <
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

    const scan = toDemoFlag(scanFlag);
    const exportPdf = toDemoFlag(exportFlag);
    const apiAccess = toDemoFlag(apiFlag);

    return NextResponse.json({
      companyKeys,
      usage: {
        scan: scan
          ? {
              allocation: scan.allocation ?? null,
              usage: scan.usage ?? 0,
              exceeded: scan.exceeded ?? false,
            }
          : null,
      },
      flags: {
        scan,
        "export-pdf": exportPdf,
        "api-access": apiAccess,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load company data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
