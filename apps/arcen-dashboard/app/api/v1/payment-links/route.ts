import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyAuth, isAnyAuthError } from "@/lib/require-any-auth";
import { createPaymentLink, listPaymentLinks } from "@/lib/payment-links";
import { db } from "@/lib/db";
import { APP_URL } from "@/lib/config";
import { writeAuditEvent } from "@/lib/audit";
import { RUNTIME_CHAIN_ID } from "@/lib/runtime-chain";
import { getUsdcAddress } from "@/lib/contracts";

const createSchema = z
  .object({
    kind: z.enum(["ADDON", "INVOICE", "CUSTOM"]),
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
    companyId: z.string().trim().optional(),
    catalogAddOnId: z.string().trim().optional(),
    invoiceId: z.string().trim().optional(),
    amount: z.coerce.number().positive().optional(),
    acceptedToken: z.string().trim().optional(),
    recipientWallet: z.string().trim().min(1),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "ADDON" && !value.catalogAddOnId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["catalogAddOnId"],
        message: "catalogAddOnId is required for ADDON payment links.",
      });
    }
    if (value.kind === "INVOICE" && !value.invoiceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["invoiceId"],
        message: "invoiceId is required for INVOICE payment links.",
      });
    }
    if (value.kind === "CUSTOM" && (!value.amount || !value.acceptedToken)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "CUSTOM payment links require amount and acceptedToken.",
      });
    }
  });

function withCheckoutUrl<T extends { slug: string }>(paymentLink: T) {
  return {
    ...paymentLink,
    checkoutUrl: `${APP_URL}/pay/${paymentLink.slug}`,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAnyAuth(request);
  if (isAnyAuthError(auth)) return auth;

  const paymentLinks = await listPaymentLinks(auth.teamId);
  return NextResponse.json({
    paymentLinks: paymentLinks.map(withCheckoutUrl),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAnyAuth(request);
  if (isAnyAuthError(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  let amount = parsed.data.amount;
  let acceptedToken = parsed.data.acceptedToken;
  let companyId = parsed.data.companyId ?? null;

  if (parsed.data.catalogAddOnId) {
    const addOn = await db.catalogAddOn.findFirst({
      where: { id: parsed.data.catalogAddOnId, teamId: auth.teamId },
      select: {
        id: true,
        name: true,
        price: true,
        acceptedToken: true,
        billingType: true,
        saleMode: true,
        status: true,
      },
    });
    if (!addOn) {
      return NextResponse.json({ error: "Add-on not found" }, { status: 404 });
    }
    if (addOn.status !== "PUBLISHED") {
      return NextResponse.json(
        { error: "Only published add-ons can be sold." },
        { status: 409 },
      );
    }
    if (addOn.billingType === "RECURRING") {
      return NextResponse.json(
        { error: "Recurring add-ons are upsells and cannot use one-time hosted checkout." },
        { status: 409 },
      );
    }
    if (addOn.saleMode === "UPSELL") {
      return NextResponse.json(
        { error: "This add-on is configured for subscriber upsells only." },
        { status: 409 },
      );
    }
    amount = Number(addOn.price);
    acceptedToken = addOn.acceptedToken;
  }

  if (parsed.data.invoiceId) {
    const invoice = await db.invoice.findFirst({
      where: { id: parsed.data.invoiceId, teamId: auth.teamId },
      select: {
        id: true,
        customerEmail: true,
        customerWallet: true,
        amountOutstanding: true,
        currency: true,
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    amount = Number(invoice.amountOutstanding);
    acceptedToken = acceptedToken ?? getUsdcAddress(RUNTIME_CHAIN_ID);
    if (!companyId && (invoice.customerWallet || invoice.customerEmail)) {
      const company = await db.arcenCompany.findFirst({
        where: {
          teamId: auth.teamId,
          OR: [
            ...(invoice.customerWallet
              ? [{ walletAddress: invoice.customerWallet.toLowerCase() }]
              : []),
            ...(invoice.customerEmail
              ? [{ email: { equals: invoice.customerEmail, mode: "insensitive" as const } }]
              : []),
          ],
        },
        select: { id: true },
      });
      companyId = company?.id ?? null;
    }
  }

  if (!amount || !acceptedToken) {
    return NextResponse.json(
      { error: "Unable to resolve payment amount and token." },
      { status: 400 },
    );
  }

  const paymentLink = await createPaymentLink({
    teamId: auth.teamId,
    kind: parsed.data.kind,
    name: parsed.data.name,
    description: parsed.data.description,
    companyId,
    catalogAddOnId: parsed.data.catalogAddOnId,
    invoiceId: parsed.data.invoiceId,
    amount,
    currency: "USDC",
    acceptedToken,
    chainId: RUNTIME_CHAIN_ID,
    recipientWallet: parsed.data.recipientWallet,
    successUrl: parsed.data.successUrl,
    cancelUrl: parsed.data.cancelUrl,
    expiresAt: parsed.data.expiresAt
      ? new Date(parsed.data.expiresAt)
      : null,
    metadata: {
      source: "dashboard",
      kind: parsed.data.kind,
    },
  });

  if (auth.source === "session") {
    await writeAuditEvent({
      request,
      teamId: auth.teamId,
      action: "payment_link.create",
      resourceType: "PaymentLink",
      resourceId: paymentLink.id,
      afterData: paymentLink,
    }).catch(() => {});
  }

  return NextResponse.json(
    { paymentLink: withCheckoutUrl(paymentLink) },
    { status: 201 },
  );
}
