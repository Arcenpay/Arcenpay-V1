import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { sendInvoiceEmail } from "@/lib/email";
import { writeAuditEvent } from "@/lib/audit";
import { ensureInvoicePdfForTeam } from "@/lib/invoice-documents";
import { rateLimit, applyRateLimitHeaders } from "@/lib/rate-limit";

// 3 resends per invoice per hour — prevents accidental email flooding
const RESEND_LIMIT = 3;
const RESEND_WINDOW_MS = 60 * 60 * 1000;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Params) {
  const auth = await requirePermission("invoices:send");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;

  const rl = rateLimit(`resend:${id}`, RESEND_LIMIT, RESEND_WINDOW_MS);
  if (!rl.ok) {
    const res = NextResponse.json(
      { error: "This invoice has been resent too many times recently. Please wait before retrying." },
      { status: 429 },
    );
    applyRateLimitHeaders(res.headers, rl, RESEND_LIMIT);
    return res;
  }
  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
    include: { deliveries: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (!invoice.customerEmail) {
    return NextResponse.json(
      { error: "Invoice has no customer email" },
      { status: 400 },
    );
  }

  const prior = invoice.deliveries[0];
  try {
    const { downloadUrl } = await ensureInvoicePdfForTeam(
      auth.team.teamId,
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
      request,
      teamId: auth.team.teamId,
      userId: auth.team.userId,
      walletAddress: auth.team.walletAddress,
      action: "invoice.resend",
      resourceType: "InvoiceDelivery",
      resourceId: delivery.id,
      metadata: { invoiceId: invoice.id, invoiceNumber: invoice.number },
    });

    return NextResponse.json({ ok: true, delivery });
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
      request,
      teamId: auth.team.teamId,
      userId: auth.team.userId,
      walletAddress: auth.team.walletAddress,
      action: "invoice.resend.failed",
      resourceType: "InvoiceDelivery",
      resourceId: delivery.id,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        error: err?.message || "send failed",
      },
    });

    return NextResponse.json(
      { error: err?.message || "Failed to send invoice" },
      { status: 502 },
    );
  }
}
