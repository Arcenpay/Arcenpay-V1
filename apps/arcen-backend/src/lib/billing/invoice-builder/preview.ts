import { db } from "../../../db.js";
import type { LoadedInvoiceContext } from "../invoice-context.js";

/**
 * Builds a representative invoice billing context for template previews.
 * Uses the team's actual profile when available so the preview reflects the
 * real provider branding; line items are sample data.
 */
export async function buildSampleInvoiceContext(input: {
  teamId: string;
  environmentId?: string | null;
}): Promise<NonNullable<LoadedInvoiceContext>> {
  const team = await db.team.findUnique({
    where: { id: input.teamId },
    select: { id: true, name: true, slug: true },
  });
  const profile = await db.providerProfile.findFirst({
    where: {
      teamId: input.teamId,
      environmentId: input.environmentId ?? null,
    },
    select: {
      providerName: true,
      website: true,
      contactEmail: true,
      legalName: true,
      billingEmail: true,
      supportEmail: true,
      supportPhone: true,
      supportUrl: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      taxId: true,
      gstin: true,
    },
  });

  const now = new Date();
  const dueIn30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    invoice: {
      id: "preview-invoice",
      number: "INV-2026-000000",
      currency: "USDC",
      customerEmail: "billing@customer.io",
      customerWallet: "0x8ba1f109551bd432803012645ac136ddd64dba72",
      subtotal: 199,
      taxTotal: 19.9,
      total: 218.9,
      amountPaid: 0,
      amountCredited: 0,
      amountOutstanding: 218.9,
      dueAt: dueIn30,
      issuedAt: now,
      paidAt: null,
      externalRef: null,
      planId: null,
      companyId: "preview-company",
      metadata: { customerName: "Sample Customer Inc." },
      templateId: null,
      templateSnapshot: null,
      teamId: input.teamId,
      environmentId: input.environmentId ?? null,
      environmentMode: "PRODUCTION",
      status: "ISSUED",
      createdAt: now,
      updatedAt: now,
      team: {
        id: input.teamId,
        name: team?.name ?? "Your Company",
        slug: team?.slug ?? "your-company",
      },
      lineItems: [
        {
          id: "preview-line-1",
          createdAt: now,
          invoiceId: "preview-invoice",
          description: "Enterprise plan — monthly subscription",
          quantity: 1,
          unitAmount: 199,
          taxRate: 10,
          lineSubtotal: 199,
          lineTax: 19.9,
          lineTotal: 218.9,
          metadata: null,
        },
      ],
      payments: [],
      deliveries: [],
      creditNotes: [],
      refunds: [],
      paymentLinks: [],
      checkoutSessions: [],
    },
    metadata: { customerName: "Sample Customer Inc." },
    receiptMeta: {},
    receiptEmailMeta: {},
    billingAddress: {
      line1: "100 Market Street",
      line2: "Suite 5E",
      city: "San Francisco",
      state: "CA",
      zip: "94105",
      country: "United States",
    },
    profile: {
      id: "preview-profile",
      createdAt: now,
      updatedAt: now,
      environmentId: input.environmentId ?? null,
      teamId: input.teamId,
      providerName: profile?.providerName ?? team?.name ?? "Your Company",
      website: profile?.website ?? null,
      contactEmail: profile?.contactEmail ?? null,
      legalName: profile?.legalName ?? null,
      billingEmail: profile?.billingEmail ?? null,
      supportEmail: profile?.supportEmail ?? null,
      supportPhone: profile?.supportPhone ?? null,
      supportUrl: profile?.supportUrl ?? null,
      addressLine1: profile?.addressLine1 ?? null,
      addressLine2: profile?.addressLine2 ?? null,
      city: profile?.city ?? null,
      state: profile?.state ?? null,
      postalCode: profile?.postalCode ?? null,
      country: profile?.country ?? null,
      taxId: profile?.taxId ?? null,
      gstin: profile?.gstin ?? null,
      notificationPreferences: null,
      apiKeyHash: null,
      apiKeyPrefix: null,
    },
    company: null,
    payment: null,
    customerName: "Sample Customer Inc.",
  } as unknown as NonNullable<LoadedInvoiceContext>;
}
