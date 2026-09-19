import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../../../db.js";
import { requireInvoiceAuth, isInvoiceAuthError } from "../../../lib/auth/invoice-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { toPrismaNullableJson } from "../../../utils/prisma-json.js";
import { sendCreditNoteEmail } from "../../../lib/billing/email.js";
import {
  applyInvoiceCredit,
  postBillingCredit,
} from "../../../lib/billing/billing-balances.js";
import { recordBillingAdjustment } from "../../../lib/billing/billing-adjustments.js";

const CREDITABLE_STATUSES = ["ISSUED", "PAID", "OVERDUE"];

const createSchema = z.object({
  reason: z.string().min(1).max(500),
  amount: z.coerce.number().positive(),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET(c: Context) {
  const auth = await requireInvoiceAuth(c, { rolePermission: "invoices:read", apiPermission: "read" });
  if (isInvoiceAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.teamId },
    select: { id: true },
  });

  if (!invoice) {
    return c.json({ error: "Invoice not found" }, 404 as any);
  }

  const creditNotes = await db.creditNote.findMany({
    where: { invoiceId: id },
    orderBy: { createdAt: "desc" },
  });

  return c.json({ creditNotes });
}

export async function POST(c: Context) {
  const auth = await requireInvoiceAuth(c, { rolePermission: "invoices:write", apiPermission: "write" });
  if (isInvoiceAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.teamId },
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
    return c.json({ error: "Invoice not found" }, 404 as any);
  }

  if (!CREDITABLE_STATUSES.includes(invoice.status)) {
    return c.json({ error: `Cannot issue credit note on a ${invoice.status} invoice` }, 409 as any);
  }

  const alreadyCredited = invoice.creditNotes.reduce(
    (sum, cn) => sum + Number(cn.amount),
    0,
  );
  const remaining = Number(invoice.total) - alreadyCredited;
  if (parsed.data.amount > remaining) {
    return c.json({
        error: `Credit amount ${parsed.data.amount} exceeds remaining creditable amount ${remaining.toFixed(6)}`,
        remaining,
      }, 422 as any);
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
      teamId: auth.teamId,
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
        teamId: auth.teamId,
        walletAddress: invoice.customerWallet.toLowerCase(),
      },
      select: {
        id: true,
        subscriptionState: { select: { id: true } },
      },
    });

    if (company) {
      await recordBillingAdjustment({
        teamId: auth.teamId,
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
    headers: { get: (name: string) => c.req.header(name) },
    teamId: auth.teamId,
    userId: auth.userId ?? undefined,
    walletAddress: auth.walletAddress ?? undefined,
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

  return c.json({ creditNote }, 201 as any);
}
