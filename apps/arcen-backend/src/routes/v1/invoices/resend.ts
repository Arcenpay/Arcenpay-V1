import type { Context } from "hono";
import { db } from "../../../db.js";
import { requireInvoiceAuth, isInvoiceAuthError } from "../../../lib/auth/invoice-auth.js";
import { sendInvoiceEmail } from "../../../lib/billing/email.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { ensureInvoicePdfForTeam } from "../../../lib/billing/invoice-documents.js";
import { invoiceResendProtect, arcjetNodeRequest } from "../../../lib/auth/arcjet.js";
import { deliverWebhook } from "../../../lib/webhooks/deliver-webhook.js";

export async function POST(c: Context) {
  const auth = await requireInvoiceAuth(c, { rolePermission: "invoices:send", apiPermission: "send" });
  if (isInvoiceAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const decision = await invoiceResendProtect.protect(
    arcjetNodeRequest(c.req.raw) as any,
    { invoiceId: id! },
  );
  if (decision.isDenied()) {
    return c.json({ error: "This invoice has been resent too many times recently. Please wait before retrying." }, 429 as any);
  }

  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.teamId },
    include: { deliveries: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (!invoice) {
    return c.json({ error: "Invoice not found" }, 404 as any);
  }

  if (!invoice.customerEmail) {
    return c.json({ error: "Invoice has no customer email" }, 400 as any);
  }

  const prior = invoice.deliveries[0];
  try {
    const { downloadUrl } = await ensureInvoicePdfForTeam(
      auth.teamId,
      invoice.id,
    );

    await sendInvoiceEmail({
      to: invoice.customerEmail,
      invoiceNumber: invoice.number || invoice.id,
      total: String(invoice.total),
      currency: invoice.currency,
      dueDate: invoice.dueAt ? invoice.dueAt.toISOString() : undefined,
      downloadUrl,
    });

    const delivery = await db.invoiceDelivery.create({
      data: {
        invoiceId: invoice.id,
        provider: "resend",
        method: "email",
        status: "SENT",
        attempts: (prior?.attempts || 0) + 1,
        sentAt: new Date(),
      },
    });

    await writeAuditEvent({
      headers: { get: (name: string) => c.req.header(name) },
      teamId: auth.teamId,
      userId: auth.userId ?? undefined,
      walletAddress: auth.walletAddress ?? undefined,
      action: "invoice.resend",
      resourceType: "InvoiceDelivery",
      resourceId: delivery.id,
      metadata: { invoiceId: invoice.id, invoiceNumber: invoice.number },
    });

    return c.json({ ok: true, delivery });
  } catch (err: any) {
    const delivery = await db.invoiceDelivery.create({
      data: {
        invoiceId: invoice.id,
        provider: "resend",
        method: "email",
        status: "FAILED",
        attempts: (prior?.attempts || 0) + 1,
        errorMessage: err?.message || "send failed",
      },
    });

    await writeAuditEvent({
      headers: { get: (name: string) => c.req.header(name) },
      teamId: auth.teamId,
      userId: auth.userId ?? undefined,
      walletAddress: auth.walletAddress ?? undefined,
      action: "invoice.resend.failed",
      resourceType: "InvoiceDelivery",
      resourceId: delivery.id,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        error: err?.message || "send failed",
      },
    });

    deliverWebhook(auth.teamId, "invoice.delivery_failed", {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      customerEmail: invoice.customerEmail,
      customerWallet: invoice.customerWallet,
      error: err?.message || "send failed",
    }).catch(() => {});

    return c.json({ error: err?.message || "Failed to send invoice" }, 502 as any);
  }
}
