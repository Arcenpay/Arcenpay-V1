import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { ensureInvoicePdfForTeam } from "@/lib/invoice-documents";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Params) {
  const auth = await requirePermission("invoices:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;
  try {
    const { downloadUrl, objectKey } = await ensureInvoicePdfForTeam(
      auth.team.teamId,
      id,
    );
    return NextResponse.json({ ok: true, downloadUrl, objectKey });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to prepare invoice document";
    const status = message === "Invoice not found" ? 404 : 400;
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
