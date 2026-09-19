import type { Context } from "hono";
import { requireInvoiceAuth, isInvoiceAuthError } from "../../../lib/auth/invoice-auth.js";
import { generateInvoiceIso20022 } from "../../../lib/billing/invoice-iso20022.js";

export async function GET(c: Context): Promise<Response> {
  const auth = await requireInvoiceAuth(c, { rolePermission: "invoices:read", apiPermission: "read" });
  if (isInvoiceAuthError(auth)) {
    return c.json(
      { ok: false, error: auth.error },
      auth.status as any as any,
    );
  }

  const id = c.req.param("id");
  try {
    const exportFile = await generateInvoiceIso20022(auth.teamId, id!);
    return new Response(exportFile.xml, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "private, max-age=60",
        "content-disposition": `attachment; filename="${exportFile.filename}"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to build ISO 20022 export";
    const status = message === "Invoice not found" ? 404 : 400;
    return c.json({ error: message }, status as any);
  }
}
