import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { allocateInvoiceNumber, toSix } from "@/lib/invoices";
import { writeAuditEvent } from "@/lib/audit";
import { toPrismaNullableJson } from "@/lib/prisma-json";
import { ensureInvoicePdfForTeam } from "@/lib/invoice-documents";
import { sendInvoiceEmail } from "@/lib/email";

const listSchema = z.object({
  status: z.enum(["DRAFT", "ISSUED", "PAID", "VOID", "OVERDUE"]).optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
  q: z.string().optional(),
});

const createSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
  customerEmail: z.string().email().optional(),
  customerWallet: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  currency: z.string().default("USDC"),
  dueAt: z.string().datetime().optional(),
  planId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.coerce.number().int().positive().default(1),
        unitAmount: z.coerce.number().nonnegative(),
        taxRate: z.coerce.number().min(0).max(100).default(0),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .min(1),
});

export async function GET(request: NextRequest) {
  const auth = await requirePermission("invoices:read");
  if (isErrorResponse(auth)) return auth;

  const parsed = listSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const where = {
    teamId: auth.team.teamId,
    ...(parsed.data.status && { status: parsed.data.status }),
    ...(parsed.data.environmentMode && {
      environmentMode: parsed.data.environmentMode,
    }),
    ...(parsed.data.q && {
      OR: [
        { number: { contains: parsed.data.q, mode: "insensitive" as const } },
        {
          customerEmail: {
            contains: parsed.data.q,
            mode: "insensitive" as const,
          },
        },
        {
          customerWallet: {
            contains: parsed.data.q,
            mode: "insensitive" as const,
          },
        },
      ],
    }),
  };

  const invoices = await db.invoice.findMany({
    where,
    include: {
      lineItems: true,
      deliveries: { orderBy: { createdAt: "desc" }, take: 3 },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });

  return NextResponse.json({ invoices });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission("invoices:write");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const team = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { slug: true, invoicePrefix: true },
  });

  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const prefix = team.invoicePrefix || `INV-${team.slug.toUpperCase()}`;
  const number = await allocateInvoiceNumber(auth.team.teamId, prefix);

  const lines = parsed.data.lines.map((line) => {
    const lineSubtotal = line.quantity * line.unitAmount;
    const lineTax = lineSubtotal * (line.taxRate / 100);
    const lineTotal = lineSubtotal + lineTax;
    return {
      description: line.description,
      quantity: line.quantity,
      unitAmount: toSix(line.unitAmount),
      taxRate: line.taxRate.toFixed(4),
      lineSubtotal: toSix(lineSubtotal),
      lineTax: toSix(lineTax),
      lineTotal: toSix(lineTotal),
      metadata: toPrismaNullableJson(line.metadata),
    };
  });

  const subtotal = lines.reduce(
    (acc, line) => acc + Number(line.lineSubtotal),
    0,
  );
  const taxTotal = lines.reduce((acc, line) => acc + Number(line.lineTax), 0);
  const total = subtotal + taxTotal;

  const invoice = await db.invoice.create({
    data: {
      teamId: auth.team.teamId,
      environmentMode: parsed.data.environmentMode,
      status: "ISSUED",
      number,
      currency: parsed.data.currency,
      customerEmail: parsed.data.customerEmail,
      customerWallet: parsed.data.customerWallet,
      subtotal: toSix(subtotal),
      taxTotal: toSix(taxTotal),
      total: toSix(total),
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
      issuedAt: new Date(),
      planId: parsed.data.planId,
      metadata: toPrismaNullableJson(parsed.data.metadata),
      lineItems: {
        createMany: { data: lines },
      },
      deliveries: {
        create: {
          provider: "resend",
          method: "email",
          status: "PENDING",
        },
      },
    },
    include: { lineItems: true, deliveries: true },
  });

  const { downloadUrl } = await ensureInvoicePdfForTeam(
    auth.team.teamId,
    invoice.id,
  );

  // Dispatch initial invoice email if we have a recipient address.
  // Update the PENDING delivery record that was created inline with the invoice.
  const pendingDelivery = invoice.deliveries[0];
  if (parsed.data.customerEmail && pendingDelivery) {
    try {
      await sendInvoiceEmail({
        to: parsed.data.customerEmail,
        invoiceNumber: invoice.number || invoice.id,
        total: String(invoice.total),
        currency: invoice.currency,
        dueDate: invoice.dueAt ? invoice.dueAt.toISOString() : undefined,
        downloadUrl,
      });
      await db.invoiceDelivery.update({
        where: { id: pendingDelivery.id },
        data: { status: "SENT", sentAt: new Date(), attempts: 1 },
      });
    } catch (err: any) {
      await db.invoiceDelivery.update({
        where: { id: pendingDelivery.id },
        data: {
          status: "FAILED",
          attempts: 1,
          errorMessage: err?.message || "send failed",
        },
      });
    }
  }

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    clerkUserId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "invoice.create",
    resourceType: "Invoice",
    resourceId: invoice.id,
    afterData: invoice,
  });

  return NextResponse.json({ invoice, downloadUrl }, { status: 201 });
}
