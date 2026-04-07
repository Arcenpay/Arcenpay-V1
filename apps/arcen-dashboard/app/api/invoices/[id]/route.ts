import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { ensureInvoicePdfForTeam } from "@/lib/invoice-documents";
import { writeAuditEvent } from "@/lib/audit";
import { deliverWebhook } from "@/lib/deliver-webhook";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Params) {
  const auth = await requirePermission("invoices:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;
  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
    include: {
      lineItems: true,
      deliveries: { orderBy: { createdAt: "desc" } },
      creditNotes: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const { downloadUrl } = await ensureInvoicePdfForTeam(
    auth.team.teamId,
    invoice.id,
  );

  return NextResponse.json({ invoice, downloadUrl });
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ISSUED"],
  ISSUED: ["PAID", "VOID", "OVERDUE"],
  OVERDUE: ["PAID", "VOID"],
};

const patchSchema = z.object({
  status: z.enum(["ISSUED", "PAID", "VOID", "OVERDUE"]),
  note: z.string().max(500).optional(),
});

export async function PATCH(request: NextRequest, context: Params) {
  const auth = await requirePermission("invoices:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;

  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const allowed = ALLOWED_TRANSITIONS[invoice.status] ?? [];
  if (!allowed.includes(parsed.data.status)) {
    return NextResponse.json(
      {
        error: `Cannot transition invoice from ${invoice.status} to ${parsed.data.status}`,
        allowed,
      },
      { status: 409 },
    );
  }

  const updated = await db.invoice.update({
    where: { id: invoice.id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.status === "PAID" && { paidAt: new Date() }),
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: `invoice.status.${parsed.data.status.toLowerCase()}`,
    resourceType: "Invoice",
    resourceId: invoice.id,
    beforeData: { status: invoice.status },
    afterData: { status: updated.status, note: parsed.data.note },
  });

  if (parsed.data.status === "PAID") {
    deliverWebhook(auth.team.teamId, "invoice.paid", {
      invoiceId: updated.id,
      invoiceNumber: updated.number,
      customerEmail: updated.customerEmail,
      customerWallet: updated.customerWallet,
      total: String(updated.total),
      currency: updated.currency,
      paidAt: updated.paidAt?.toISOString() ?? null,
    }).catch(() => {});
  }

  return NextResponse.json({ invoice: updated });
}
