import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { getInvoicePdfDownloadUrl } from "../../../lib/billing/invoice-documents.js";

export async function GET(c: Context) {
  const auth = await requirePermission(c, "invoices:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  try {
    const { downloadUrl } = await getInvoicePdfDownloadUrl({
      teamId: auth.team.teamId,
      invoiceId: id!,
      kind: "invoice",
    });
    return c.json({ ok: true, downloadUrl });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to prepare invoice document";
    const status = message === "Invoice not found" ? 404 : 400;
    return c.json(
      { error: message },
      status,
    );
  }
}
