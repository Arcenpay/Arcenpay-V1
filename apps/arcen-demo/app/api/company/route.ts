import { NextResponse } from "next/server";
import { getArcenClient, getDemoCompanyKeys } from "@/lib/arcen-client";

/**
 * GET /api/company
 *
 * Returns the current demo company's data (plan, entitlements, flags).
 */
export async function GET() {
  try {
    const client = getArcenClient();
    const companyKeys = getDemoCompanyKeys();

    // Check a few demo flags in parallel
    const [scanFlag, exportFlag, apiFlag] = await Promise.allSettled([
      client.checkFlag("scan", companyKeys),
      client.checkFlag("export-pdf", companyKeys),
      client.checkFlag("api-access", companyKeys),
    ]);

    return NextResponse.json({
      companyKeys,
      flags: {
        scan: scanFlag.status === "fulfilled" ? scanFlag.value : null,
        "export-pdf": exportFlag.status === "fulfilled" ? exportFlag.value : null,
        "api-access": apiFlag.status === "fulfilled" ? apiFlag.value : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load company data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
