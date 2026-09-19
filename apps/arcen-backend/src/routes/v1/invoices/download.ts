import type { Context } from "hono";
import { requireInvoiceAuth, isInvoiceAuthError } from "../../../lib/auth/invoice-auth.js";
import { getInvoicePdfDownloadUrl } from "../../../lib/billing/invoice-documents.js";

export async function GET(c: Context) {
  const auth = await requireInvoiceAuth(c, { rolePermission: "invoices:read", apiPermission: "read" });
  if (isInvoiceAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  try {
    const { downloadUrl } = await getInvoicePdfDownloadUrl({
      teamId: auth.teamId,
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
