import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiKeyContext } from "../lib/auth/api-key-auth.js";
import type { McpDeps } from "./deps.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/**
 * Registers the read-only tool tier on a fresh McpServer.
 *
 * Every tool closes over the authenticated context and the injected deps, so a
 * request can only ever read the caller's own team data. No tool in this file
 * mutates state or moves funds — that is deliberate: this tier is the one that
 * is safe to list publicly and to expose to assistants.
 */
export function registerReadOnlyTools(
  server: McpServer,
  ctx: ApiKeyContext,
  deps: McpDeps,
): void {
  server.registerTool(
    "get_account",
    {
      title: "Get account",
      description:
        "Returns the authenticated ArcenPay account context: team id, active environment, credential type, and granted permissions. Use this first to confirm which workspace the other tools act on.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      ok({
        teamId: ctx.teamId,
        environmentId: ctx.environmentId,
        keyType: ctx.keyType,
        environmentMode: ctx.environmentMode,
        permissions: ctx.permissions,
      }),
  );

  server.registerTool(
    "list_companies",
    {
      title: "List companies",
      description:
        "Lists customer companies in the authenticated workspace environment, most recently seen first. Use this to find a company before inspecting its plan or status.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
        search: z.string().optional(),
      },
      annotations: READ_ONLY,
    },
    async (args) => ok(await deps.listCompanies(ctx, args)),
  );

  server.registerTool(
    "get_company",
    {
      title: "Get company",
      description:
        "Returns a single customer company by id, including its active plan reference. Use after list_companies to inspect one company.",
      inputSchema: { id: z.string() },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const company = await deps.getCompany(ctx, id);
      return company ? ok(company) : fail(`No company found with id "${id}".`);
    },
  );

  server.registerTool(
    "list_payment_links",
    {
      title: "List payment links",
      description:
        "Lists payment links in the authenticated workspace, including amount, currency, chain, and status. Read-only; creating or charging is not available.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => ok(await deps.listPaymentLinks(ctx)),
  );

  server.registerTool(
    "get_payment_link_spec",
    {
      title: "Preview payment link spec",
      description:
        "Returns the machine-readable agentic specification for a payment link by slug (amount, token, chain, recipient wallet, status). Read-only preview that never moves funds.",
      inputSchema: { slug: z.string() },
      annotations: READ_ONLY,
    },
    async ({ slug }) => {
      const spec = await deps.getPaymentLinkSpec(ctx, slug);
      return spec ? ok(spec) : fail(`No payment link found for slug "${slug}".`);
    },
  );

  server.registerTool(
    "get_mandate_status",
    {
      title: "Get mandate status",
      description:
        "Returns the status of an autonomous agent payment mandate (active, revoked, expired, superseded). Read-only.",
      inputSchema: { mandateId: z.string() },
      annotations: READ_ONLY,
    },
    async ({ mandateId }) => ok(deps.getMandateStatus(mandateId)),
  );

  server.registerTool(
    "get_settlement_status",
    {
      title: "Get settlement status",
      description:
        "Returns the lifecycle status of an escrow settlement reservation by its request nonce (reserved, released, refunded, disputed). Read-only.",
      inputSchema: { requestNonce: z.string() },
      annotations: READ_ONLY,
    },
    async ({ requestNonce }) => ok(deps.getSettlementStatus(requestNonce)),
  );

  server.registerTool(
    "list_plans",
    {
      title: "List plans",
      description:
        "Lists published catalog plans for the authenticated workspace (name, tier, price, interval, token, chain). Use to discover what the workspace offers.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => ok(await deps.listPlans(ctx)),
  );

  server.registerTool(
    "list_addons",
    {
      title: "List add-ons",
      description:
        "Lists published add-ons (one-time or metered products) for the authenticated workspace, with price, billing type, and sale mode.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => ok(await deps.listAddons(ctx)),
  );

  server.registerTool(
    "get_subscription",
    {
      title: "Get subscription",
      description:
        "Returns a company's subscription state: status, plan, current period, whether it cancels at period end, and any grace window. Use after list_companies.",
      inputSchema: { companyId: z.string() },
      annotations: READ_ONLY,
    },
    async ({ companyId }) => {
      const subscription = await deps.getSubscription(ctx, companyId);
      return subscription
        ? ok(subscription)
        : fail(`No company found with id "${companyId}".`);
    },
  );

  server.registerTool(
    "check_entitlement",
    {
      title: "Check customer entitlement",
      description:
        "Evaluates whether a company is entitled to a feature key, returning enabled/allocation/usage/exceeded. Read-only; does not consume quota.",
      inputSchema: { companyId: z.string(), featureKey: z.string() },
      annotations: READ_ONLY,
    },
    async ({ companyId, featureKey }) => {
      const result = await deps.checkEntitlement(ctx, companyId, featureKey);
      return result
        ? ok(result)
        : fail(`No company found with id "${companyId}".`);
    },
  );

  server.registerTool(
    "list_invoices",
    {
      title: "List invoices",
      description:
        "Lists invoices for the authenticated workspace (number, status, totals, outstanding, dates), newest first. Read-only.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        status: z.enum(["DRAFT", "ISSUED", "PAID", "VOID", "OVERDUE"]).optional(),
      },
      annotations: READ_ONLY,
    },
    async (args) => ok(await deps.listInvoices(ctx, args)),
  );

  server.registerTool(
    "get_invoice",
    {
      title: "Get invoice",
      description: "Returns a single invoice by id. Read-only.",
      inputSchema: { id: z.string() },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const invoice = await deps.getInvoice(ctx, id);
      return invoice ? ok(invoice) : fail(`No invoice found with id "${id}".`);
    },
  );

  server.registerTool(
    "get_invoice_download_url",
    {
      title: "Get invoice download URL",
      description:
        "Returns a short-lived signed URL that renders the invoice PDF (kind: invoice or receipt). Read-only; the URL is HMAC-signed and expires.",
      inputSchema: {
        id: z.string(),
        kind: z.enum(["invoice", "receipt"]).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ id, kind }) => {
      const documentKind = kind ?? "invoice";
      const url = await deps.getInvoiceDownloadUrl(ctx, id, documentKind);
      return url
        ? ok({ invoiceId: id, kind: documentKind, url })
        : fail(`No invoice found with id "${id}".`);
    },
  );

  server.registerTool(
    "list_chains",
    {
      title: "List supported chains",
      description:
        "Lists the chains ArcenPay supports (chain id, name, testnet flag, family, deployed contract addresses). Use to confirm where settlement can occur.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => ok(await deps.listChains()),
  );
}
