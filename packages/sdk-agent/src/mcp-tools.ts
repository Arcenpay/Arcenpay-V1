// ============================================================
//  @arcenpay/agent — Model Context Protocol (MCP) Tools
//  Exports standard MCP tool definitions & dispatcher for
//  AI agents to discover, pay, and create payment links.
// ============================================================

import type { ArcenAgent } from "./agent";
import type { CreateAgentPaymentLinkParams, PayPaymentLinkOptions } from "./internal/core";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

export const ARCENPAY_MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "arcenpay_resolve_payment_link",
    description:
      "Discovers and inspects an ArcenPay payment link (by URL or slug). Returns machine-readable pricing, currency, chain, recipient, and status without spending any funds.",
    inputSchema: {
      type: "object",
      properties: {
        urlOrSlug: {
          type: "string",
          description: "Full ArcenPay checkout URL (e.g. 'https://app.arcenpay.xyz/pay/my-slug') or payment link slug.",
        },
      },
      required: ["urlOrSlug"],
    },
  },
  {
    name: "arcenpay_pay_payment_link",
    description:
      "Executes an autonomous payment for an ArcenPay payment link within configured budget limits. Handles on-chain transfer (EVM ERC-20 or Stellar SAC) and returns a cryptographic payment receipt.",
    inputSchema: {
      type: "object",
      properties: {
        urlOrSlug: {
          type: "string",
          description: "Full ArcenPay checkout URL or payment link slug.",
        },
        maxPrice: {
          type: "string",
          description: "Safety ceiling: maximum price willing to pay in decimal USDC (e.g. '0.50'). Payment fails if required amount exceeds this.",
        },
        customerName: {
          type: "string",
          description: "Optional identifying name of the paying agent or user.",
        },
        customerEmail: {
          type: "string",
          description: "Optional email to receive payment confirmation / receipt.",
        },
      },
      required: ["urlOrSlug"],
    },
  },
  {
    name: "arcenpay_create_payment_link",
    description:
      "Creates a new agentic payment link so this agent can accept cryptocurrency payments for APIs, inferences, or services.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the item or service being paid for (e.g. 'AI Analysis Report').",
        },
        amount: {
          type: "number",
          description: "Amount to charge in decimal currency units (e.g. 5.0 for 5 USDC).",
        },
        description: {
          type: "string",
          description: "Optional description of what the payer receives.",
        },
        currency: {
          type: "string",
          description: "Currency symbol, defaults to 'USDC'.",
        },
        chainId: {
          type: "number",
          description: "Chain ID for payment settlement (defaults to the agent's configured chain).",
        },
        recipientWallet: {
          type: "string",
          description: "Payout wallet address (defaults to the agent's wallet).",
        },
        expiresInMinutes: {
          type: "number",
          description: "Optional expiration time in minutes.",
        },
        successUrl: {
          type: "string",
          description: "Optional URL to redirect or return after successful payment.",
        },
      },
      required: ["title", "amount"],
    },
  },
  {
    name: "arcenpay_get_spend_summary",
    description:
      "Retrieves the agent's current spend summary, including daily spent, total spent, daily budget limit, and auto-approve threshold.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Creates MCP tool definitions and an execution dispatcher bound to an initialized ArcenAgent.
 */
export function createArcenAgentMcpTools(agent: ArcenAgent) {
  return {
    tools: ARCENPAY_MCP_TOOL_DEFINITIONS,
    async handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResponse> {
      try {
        switch (name) {
          case "arcenpay_resolve_payment_link": {
            const urlOrSlug = String(args.urlOrSlug ?? "");
            if (!urlOrSlug) {
              return {
                isError: true,
                content: [{ type: "text", text: "Missing required argument: urlOrSlug" }],
              };
            }
            const spec = await agent.resolvePaymentLink(urlOrSlug);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(spec, null, 2),
                },
              ],
            };
          }

          case "arcenpay_pay_payment_link": {
            const urlOrSlug = String(args.urlOrSlug ?? "");
            if (!urlOrSlug) {
              return {
                isError: true,
                content: [{ type: "text", text: "Missing required argument: urlOrSlug" }],
              };
            }
            const options: PayPaymentLinkOptions = {
              maxPrice: args.maxPrice ? String(args.maxPrice) : undefined,
              customerName: args.customerName ? String(args.customerName) : undefined,
              customerEmail: args.customerEmail ? String(args.customerEmail) : undefined,
            };
            const receipt = await agent.payPaymentLink(urlOrSlug, options);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(receipt, null, 2),
                },
              ],
            };
          }

          case "arcenpay_create_payment_link": {
            const title = String(args.title ?? "");
            const amount = Number(args.amount);
            if (!title || isNaN(amount) || amount <= 0) {
              return {
                isError: true,
                content: [{ type: "text", text: "Invalid arguments: title and positive amount are required." }],
              };
            }
            const params: CreateAgentPaymentLinkParams = {
              title,
              amount,
              description: args.description ? String(args.description) : undefined,
              currency: args.currency ? String(args.currency) : undefined,
              chainId: args.chainId ? Number(args.chainId) : undefined,
              recipientWallet: args.recipientWallet ? String(args.recipientWallet) : undefined,
              expiresInMinutes: args.expiresInMinutes ? Number(args.expiresInMinutes) : undefined,
              successUrl: args.successUrl ? String(args.successUrl) : undefined,
            };
            const spec = await agent.createPaymentLink(params);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(spec, null, 2),
                },
              ],
            };
          }

          case "arcenpay_get_spend_summary": {
            const summary = agent.getSpendSummary();
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(summary, null, 2),
                },
              ],
            };
          }

          default:
            return {
              isError: true,
              content: [{ type: "text", text: `Unknown MCP tool: ${name}` }],
            };
        }
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Tool error (${name}): ${err?.message ?? String(err)}` }],
        };
      }
    },
  };
}
