import {
  createInvoiceDownloadUrl,
  verifyInvoiceDownloadToken,
  ensureInvoicePdfForTeam,
  readSignedInvoicePdf,
  readObject,
} from '../lib/billing/invoice-documents';
import {
  consumeMeteredEntitlement,
  type ConsumeEntitlementInput,
  type ConsumeEntitlementResult,
} from '../lib/billing/usage-consume';

export class InvoiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "InvoiceError";
  }
}

export class InvoiceService {
  // ── Invoice Documents ──────────────────────────────────────────────────────

  createInvoiceDownloadUrl(
    invoiceId: string,
    objectKey: string,
    expiresInSeconds?: number,
  ): string {
    return createInvoiceDownloadUrl(invoiceId, objectKey, expiresInSeconds);
  }

  verifyInvoiceDownloadToken(input: {
    invoiceId: string;
    objectKey: string;
    expRaw: string;
    signature: string;
  }): boolean {
    return verifyInvoiceDownloadToken(input);
  }

  async ensureInvoicePdfForTeam(
    teamId: string,
    invoiceId: string,
  ): Promise<{ objectKey: string; downloadUrl: string }> {
    try {
      return await ensureInvoicePdfForTeam(teamId, invoiceId);
    } catch (error) {
      throw new InvoiceError(
        error instanceof Error ? error.message : "Failed to generate invoice PDF",
        500,
        "INVOICE_PDF_GENERATION_FAILED",
      );
    }
  }

  async readSignedInvoicePdf(params: {
    invoiceId: string;
    objectKey: string;
    expRaw: string;
    signature: string;
  }): Promise<{ bytes: Buffer; filename: string } | null> {
    return readSignedInvoicePdf(params);
  }

  async readObject(objectKey: string): Promise<Buffer | null> {
    return readObject(objectKey);
  }

  // ── Usage Consumption ──────────────────────────────────────────────────────

  async consumeMeteredEntitlement(
    input: ConsumeEntitlementInput,
  ): Promise<ConsumeEntitlementResult> {
    try {
      return await consumeMeteredEntitlement(input);
    } catch (error) {
      const statusCode = (error as { statusCode?: number } | undefined)?.statusCode;
      if (error instanceof Error && typeof statusCode === "number") {
        throw new InvoiceError(
          error.message,
          statusCode,
          "USAGE_CONSUME_FAILED",
        );
      }
      throw new InvoiceError(
        error instanceof Error ? error.message : "Failed to consume metered entitlement",
        500,
        "USAGE_CONSUME_FAILED",
      );
    }
  }
}

export const invoiceService = new InvoiceService();
