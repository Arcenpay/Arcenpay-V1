import { db } from "../../db.js";
import { asRecord, readString } from "./utils.js";

export type LoadedInvoiceContext = Awaited<ReturnType<typeof loadInvoiceBillingContext>>;

export async function loadInvoiceBillingContext(
  teamId: string,
  invoiceId: string,
) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, teamId },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      lineItems: { orderBy: { createdAt: "asc" } },
      payments: {
        where: { status: "SUCCEEDED" },
        orderBy: [{ settledAt: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
    },
  });

  if (!invoice) {
    return null;
  }

  const metadata = asRecord(invoice.metadata);
  const companyId = readString(metadata.companyId);
  const explicitCustomerName = readString(metadata.customerName);
  const billingAddress = asRecord(metadata.billingAddress);
  const receiptMeta = asRecord(metadata.receipt);
  const receiptEmailMeta = asRecord(metadata.receiptEmail);

  const [profile, company] = await Promise.all([
    db.providerProfile.findFirst({
      where: {
        teamId,
        environmentId: invoice.environmentId ?? null,
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
    }),
    companyId
      ? db.arcenCompany.findFirst({
          where: {
            id: companyId,
            teamId,
            environmentId: invoice.environmentId ?? null,
          },
          select: {
            id: true,
            name: true,
            email: true,
            walletAddress: true,
          },
        })
      : invoice.customerWallet
        ? db.arcenCompany.findFirst({
            where: {
              teamId,
              environmentId: invoice.environmentId ?? null,
              walletAddress: invoice.customerWallet,
            },
            select: {
              id: true,
              name: true,
              email: true,
              walletAddress: true,
            },
          })
        : null,
  ]);

  return {
    invoice,
    metadata,
    receiptMeta,
    receiptEmailMeta,
    billingAddress,
    profile,
    company,
    payment: invoice.payments[0] ?? null,
    customerName:
      explicitCustomerName ??
      company?.name ??
      readString(billingAddress.legalName) ??
      readString(billingAddress.name) ??
      null,
  };
}

export function getStoredReceiptNumber(
  input: Pick<NonNullable<LoadedInvoiceContext>, "invoice" | "receiptMeta">,
): string {
  const stored = readString(input.receiptMeta.number);
  if (stored) return stored;
  const invoiceNumber = input.invoice.number?.trim();
  if (invoiceNumber) {
    return invoiceNumber.startsWith("INV-")
      ? invoiceNumber.replace(/^INV-/, "RCT-")
      : `RCT-${invoiceNumber}`;
  }
  return `RCT-${input.invoice.id.slice(-10).toUpperCase()}`;
}

export function getProviderDisplayName(
  input: Pick<NonNullable<LoadedInvoiceContext>, "profile" | "invoice">,
): string {
  return (
    input.profile?.providerName?.trim() ||
    input.profile?.legalName?.trim() ||
    input.invoice.team.name
  );
}

export function getProviderAddressLines(
  input: Pick<NonNullable<LoadedInvoiceContext>, "profile">,
): string[] {
  const profile = input.profile;
  if (!profile) return [];

  const lines = [
    profile.legalName || profile.providerName || null,
    profile.addressLine1,
    profile.addressLine2,
    [profile.city, profile.state, profile.postalCode].filter(Boolean).join(", ") || null,
    profile.country,
    profile.supportPhone,
    profile.billingEmail || profile.contactEmail || null,
    profile.taxId?.trim() ? `Tax ID: ${profile.taxId.trim()}` : null,
    profile.gstin?.trim() ? `GSTIN: ${profile.gstin.trim()}` : null,
  ];

  return lines
    .map((value) => readString(value))
    .filter((value): value is string => Boolean(value));
}

export function getCustomerAddressLines(
  input: Pick<
    NonNullable<LoadedInvoiceContext>,
    "billingAddress" | "company" | "invoice" | "customerName"
  >,
): string[] {
  const billingAddress = input.billingAddress;
  const lines = [
    input.customerName,
    readString(billingAddress.line1),
    readString(billingAddress.line2),
    [
      readString(billingAddress.city),
      readString(billingAddress.state),
      readString(billingAddress.zip) || readString(billingAddress.pincode) || readString(billingAddress.postalCode),
    ]
      .filter(Boolean)
      .join(", ") || null,
    readString(billingAddress.country),
    input.invoice.customerEmail || input.company?.email || null,
    input.invoice.customerWallet || input.company?.walletAddress || null,
  ];

  return lines.filter((value): value is string => Boolean(value));
}

export function getSupportDetails(
  input: Pick<NonNullable<LoadedInvoiceContext>, "profile">,
) {
  return {
    email:
      input.profile?.supportEmail?.trim() ||
      input.profile?.billingEmail?.trim() ||
      input.profile?.contactEmail?.trim() ||
      null,
    phone: input.profile?.supportPhone?.trim() || null,
    url:
      input.profile?.supportUrl?.trim() ||
      input.profile?.website?.trim() ||
      null,
  };
}

export function getPaymentMethodLabel(
  input: Pick<NonNullable<LoadedInvoiceContext>, "invoice" | "payment" | "metadata">,
): string {
  const metadata = input.metadata;
  const explicit =
    readString(metadata.paymentMethodLabel) ||
    readString(asRecord(input.payment?.metadata).paymentMethodLabel);
  if (explicit) return explicit;

  if (input.payment?.acceptedToken) {
    return `${input.invoice.currency} via on-chain wallet`;
  }

  if (input.invoice.customerWallet) {
    return "On-chain wallet charge";
  }

  return "Direct payment";
}

export function readReceiptObjectKey(
  input: Pick<NonNullable<LoadedInvoiceContext>, "receiptMeta">,
): string | null {
  return readString(input.receiptMeta.objectKey);
}
