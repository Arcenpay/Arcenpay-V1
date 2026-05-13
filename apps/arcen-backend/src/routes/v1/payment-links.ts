import type { Context } from "hono";
import { z } from "zod";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import { createPaymentLink, listPaymentLinks } from "../../lib/payments/payment-links.js";
import { db } from "../../db.js";
import { APP_URL } from "../../config.js";
import { writeAuditEvent } from "../../lib/platform/audit.js";
import { RUNTIME_CHAIN_ID } from "../../lib/platform/runtime-chain.js";
import { getUsdcAddress } from "../../lib/platform/contracts.js";
import { requireResolvedActiveEnvironment } from "../../lib/environments/workspace-environments.js";

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

export async function GET(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const activeEnvironment =
    auth.source === "session" && auth.sessionId
      ? await requireResolvedActiveEnvironment(
          {
            sessionId: auth.sessionId,
            activeEnvironmentId: auth.activeEnvironmentId ?? null,
          },
          auth.teamId,
        )
      : null;

  const paymentLinks = await listPaymentLinks(
    auth.teamId,
    activeEnvironment?.id ?? undefined,
  );
  return c.json({
    paymentLinks: paymentLinks.map(withCheckoutUrl),
  });
}

export async function POST(c: Context) {
  const auth = await requireAnyAuth(c);
  if (isAnyAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const activeEnvironment =
    auth.source === "session" && auth.sessionId
      ? await requireResolvedActiveEnvironment(
          {
            sessionId: auth.sessionId,
            activeEnvironmentId: auth.activeEnvironmentId ?? null,
          },
          auth.teamId,
        )
      : null;

  let amount = parsed.data.amount;
  let acceptedToken = parsed.data.acceptedToken;
  let companyId = parsed.data.companyId ?? null;
  let resolvedEnvironmentId = activeEnvironment?.id ?? null;
  let resolvedChainId = activeEnvironment?.chainId ?? RUNTIME_CHAIN_ID;

  if (parsed.data.catalogAddOnId) {
    const addOn = await db.catalogAddOn.findFirst({
      where: { id: parsed.data.catalogAddOnId, teamId: auth.teamId },
      select: {
        id: true,
        name: true,
        price: true,
        acceptedToken: true,
        environmentId: true,
        environment: {
          select: {
            chainId: true,
          },
        },
        billingType: true,
        saleMode: true,
        status: true,
      },
    });
    if (!addOn) {
      return c.json({ error: "Add-on not found" }, 404 as any);
    }
    if (addOn.status !== "PUBLISHED") {
      return c.json({ error: "Only published add-ons can be sold." }, 409 as any);
    }
    if (addOn.billingType === "RECURRING") {
      return c.json({ error: "Recurring add-ons are upsells and cannot use one-time hosted checkout." }, 409 as any);
    }
    if (addOn.saleMode === "UPSELL") {
      return c.json({ error: "This add-on is configured for subscriber upsells only." }, 409 as any);
    }
    amount = Number(addOn.price);
    acceptedToken = addOn.acceptedToken;
    resolvedEnvironmentId = addOn.environmentId ?? resolvedEnvironmentId;
    resolvedChainId = addOn.environment?.chainId ?? resolvedChainId;
  }

  if (parsed.data.invoiceId) {
    const invoice = await db.invoice.findFirst({
      where: { id: parsed.data.invoiceId, teamId: auth.teamId },
      select: {
        id: true,
        environmentId: true,
        environment: {
          select: {
            chainId: true,
          },
        },
        customerEmail: true,
        customerWallet: true,
        amountOutstanding: true,
        currency: true,
      },
    });
    if (!invoice) {
      return c.json({ error: "Invoice not found" }, 404 as any);
    }
    resolvedChainId = invoice.environment?.chainId ?? resolvedChainId;
    amount = Number(invoice.amountOutstanding);
    acceptedToken = acceptedToken ?? getUsdcAddress(resolvedChainId);
    resolvedEnvironmentId = invoice.environmentId ?? resolvedEnvironmentId;
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
    return c.json({ error: "Unable to resolve payment amount and token." }, 400 as any);
  }

  const paymentLink = await createPaymentLink({
    teamId: auth.teamId,
    environmentId: resolvedEnvironmentId,
    kind: parsed.data.kind,
    name: parsed.data.name,
    description: parsed.data.description,
    companyId,
    catalogAddOnId: parsed.data.catalogAddOnId,
    invoiceId: parsed.data.invoiceId,
    amount,
    currency: "USDC",
    acceptedToken,
    chainId: resolvedChainId,
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
      headers: { get: (name: string) => c.req.header(name) },
      teamId: auth.teamId,
      action: "payment_link.create",
      resourceType: "PaymentLink",
      resourceId: paymentLink.id,
      afterData: paymentLink,
    }).catch(() => {});
  }

  return c.json({ paymentLink: withCheckoutUrl(paymentLink) }, 201 as any);
}
