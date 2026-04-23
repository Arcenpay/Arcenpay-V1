import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { toPrismaNullableJson } from "@/lib/prisma-json";
import { sendCreditNoteEmail } from "@/lib/email";
import {
  applyInvoiceCredit,
  postBillingCredit,
} from "@/lib/billing-balances";
import { recordBillingAdjustment } from "@/lib/billing-adjustments";

type Params = { params: Promise<{ id: string }> };

// Only invoices that are active/settled can have credit notes issued.
// DRAFT and VOID invoices cannot be credited.
const CREDITABLE_STATUSES = ["ISSUED", "PAID", "OVERDUE"];

const createSchema = z.object({
  reason: z.string().min(1).max(500),
  amount: z.coerce.number().positive(),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET(_request: NextRequest, context: Params) {
  const auth = await requirePermission("invoices:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;
  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
    select: { id: true },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const creditNotes = await db.creditNote.findMany({
    where: { invoiceId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ creditNotes });
}

export async function POST(request: NextRequest, context: Params) {
  const auth = await requirePermission("invoices:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
    include: {
      creditNotes: { select: { amount: true } },
      payments: {
        where: { status: "SUCCEEDED" },
        orderBy: { settledAt: "desc" },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (!CREDITABLE_STATUSES.includes(invoice.status)) {
    return NextResponse.json(
      { error: `Cannot issue credit note on a ${invoice.status} invoice` },
      { status: 409 },
    );
  }

  // Guard: total credited amount must not exceed invoice total
  const alreadyCredited = invoice.creditNotes.reduce(
    (sum, cn) => sum + Number(cn.amount),
    0,
  );
  const remaining = Number(invoice.total) - alreadyCredited;
  if (parsed.data.amount > remaining) {
    return NextResponse.json(
      {
        error: `Credit amount ${parsed.data.amount} exceeds remaining creditable amount ${remaining.toFixed(6)}`,
        remaining,
      },
      { status: 422 },
    );
  }

  const suffix = randomBytes(4).toString("hex");
  const noteNumber = `CN-${invoice.number || invoice.id}-${suffix}`;

  const creditNote = await db.creditNote.create({
    data: {
      invoiceId: invoice.id,
      noteNumber,
      reason: parsed.data.reason,
      amount: parsed.data.amount.toFixed(6),
      metadata: toPrismaNullableJson(parsed.data.metadata),
    },
  });

  await applyInvoiceCredit({
    invoiceId: invoice.id,
    amount: parsed.data.amount,
  });

  if (invoice.status === "PAID" && invoice.customerWallet) {
    await postBillingCredit({
      teamId: auth.team.teamId,
      walletAddress: invoice.customerWallet,
      amount: parsed.data.amount,
      metadata: {
        source: "credit-note",
        invoiceId: invoice.id,
        creditNoteId: creditNote.id,
        noteNumber,
      },
    });

    const company = await db.arcenCompany.findFirst({
      where: {
        teamId: auth.team.teamId,
        walletAddress: invoice.customerWallet.toLowerCase(),
      },
      select: {
        id: true,
        subscriptionState: { select: { id: true } },
      },
    });

    if (company) {
      await recordBillingAdjustment({
        teamId: auth.team.teamId,
        companyId: company.id,
        subscriptionStateId: company.subscriptionState?.id ?? null,
        paymentId: invoice.payments[0]?.id ?? null,
        kind: "MANUAL_CREDIT",
        status: "POSTED",
        amount: parsed.data.amount,
        effectiveAt: new Date(),
        postedAt: new Date(),
        metadata: {
          source: "credit-note",
          invoiceId: invoice.id,
          creditNoteId: creditNote.id,
          noteNumber,
          reason: parsed.data.reason,
        },
      });
    }
  }

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "invoice.creditnote.create",
    resourceType: "CreditNote",
    resourceId: creditNote.id,
    afterData: {
      invoiceId: invoice.id,
      noteNumber,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
    },
  });

  // Deliver credit note notification email if the invoice has a customer email
  if (invoice.customerEmail) {
    sendCreditNoteEmail({
      to: invoice.customerEmail,
      invoiceNumber: invoice.number || invoice.id,
      noteNumber,
      amount: parsed.data.amount.toFixed(2),
      currency: invoice.currency,
      reason: parsed.data.reason,
    }).catch((err) => {
      console.error("[credit-notes] email delivery failed:", err);
    });
  }

  return NextResponse.json({ creditNote }, { status: 201 });
}
