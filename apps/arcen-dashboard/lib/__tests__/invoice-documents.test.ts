import { describe, it, expect } from "vitest";
import {
  createInvoiceDownloadUrl,
  verifyInvoiceDownloadToken,
} from "@/lib/invoice-documents";

describe("invoice download signing", () => {
  it("creates a verifiable signed URL token", () => {
    const url = createInvoiceDownloadUrl("inv_1", "invoices/inv_1/demo.pdf", 3600);
    const parsed = new URL(url);
    const exp = parsed.searchParams.get("exp");
    const sig = parsed.searchParams.get("sig");
    const key = parsed.searchParams.get("key");

    expect(exp).toBeTruthy();
    expect(sig).toBeTruthy();
    expect(key).toBe("invoices/inv_1/demo.pdf");

    const valid = verifyInvoiceDownloadToken({
      invoiceId: "inv_1",
      objectKey: key || "",
      expRaw: exp || "",
      signature: sig || "",
    });
    expect(valid).toBe(true);
  });

  it("rejects expired tokens", () => {
    const valid = verifyInvoiceDownloadToken({
      invoiceId: "inv_1",
      objectKey: "invoices/inv_1/demo.pdf",
      expRaw: String(Math.floor(Date.now() / 1000) - 60),
      signature: "invalid-signature",
    });
    expect(valid).toBe(false);
  });
});
