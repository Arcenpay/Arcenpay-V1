import type { Context } from "hono";
import { renderSignedInvoicePdf } from "../../../lib/billing/invoice-documents.js";

export async function GET(c: Context): Promise<Response> {
  const id = c.req.param("id");
  const kind = c.req.query("kind") || "invoice";
  const exp = c.req.query("exp") || "";
  const sig = c.req.query("sig") || "";

  if (kind !== "invoice" && kind !== "receipt") {
    return c.json({ error: "Invalid download token" }, 400 as any);
  }
  if (!exp || !sig) {
    return c.json({ error: "Missing download token" }, 400 as any);
  }

  const result = await renderSignedInvoicePdf({
    invoiceId: id!,
    kind,
    expRaw: exp,
    signature: sig,
  });

  if (!result) {
    return c.json({ error: "Invalid or expired download token" }, 401 as any);
  }

  return new Response(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "cache-control": "private, max-age=60",
      "content-disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
