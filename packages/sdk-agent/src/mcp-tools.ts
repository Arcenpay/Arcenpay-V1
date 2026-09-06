// ============================================================
//  @arcenpay/agent — Model Context Protocol (MCP) Tools
//  Exports standard MCP tool definitions & dispatcher for
//  AI agents to discover, pay, and create payment links.
// ============================================================

import type { ArcenAgent } from "./agent";
import type {
  CreateAgentPaymentLinkParams,
  PayPaymentLinkOptions,
  MandateScope,
  EscrowMode,
  DisputeReason,
  ProviderCommitment,
} from "./internal/core";

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
  {
    name: "arcenpay_issue_mandate",
    description:
      "Issues a scoped financial delegation credential (AAM) for a sub-agent or delegate with bounded limits (maxAmount, tokens, allowedDomains, expiry).",
    inputSchema: {
      type: "object",
      properties: {
        childAgentId: {
          type: "string",
          description: "Unique identifier for the delegate / child agent.",
        },
        childPublicKey: {
          type: "string",
          description: "Public key or address of the delegate / child agent.",
        },
        maxPerTxn: {
          type: "string",
          description: "Maximum spend permitted per single transaction in decimal units (e.g. '5.0' USDC).",
        },
        maxDaily: {
          type: "string",
          description: "Maximum cumulative spend permitted per 24 hours (e.g. '25.0' USDC).",
        },
        maxTotal: {
          type: "string",
          description: "Maximum lifetime spend permitted under this delegation (e.g. '100.0' USDC).",
        },
        allowedTokens: {
          type: "array",
          items: { type: "string" },
          description: "List of token symbols allowed (e.g. ['USDC']). Defaults to ['USDC', 'USDT'].",
        },
        allowedRecipients: {
          type: "array",
          items: { type: "string" },
          description: "List of allowed recipient addresses or '*' for wildcard.",
        },
        allowedDomains: {
          type: "array",
          items: { type: "string" },
          description: "List of allowed merchant / resource domains (e.g. ['*.anthropic.com']).",
        },
        validUntil: {
          type: "string",
          description: "ISO timestamp when this mandate expires.",
        },
        isSubMandate: {
          type: "boolean",
          description: "Whether to issue as a sub-mandate under parent mandate (default true if agent has mandate).",
        },
      },
      required: ["childAgentId", "childPublicKey"],
    },
  },
  {
    name: "arcenpay_check_policy",
    description:
      "Evaluates Turnkey-style deterministic policies (evaluates Root Co-sign -> Explicit Deny -> Explicit Allow -> Default Deny) against a prospective transaction or resource request.",
    inputSchema: {
      type: "object",
      properties: {
        amount: {
          type: "string",
          description: "Transaction amount in decimal currency units (e.g. '2.50').",
        },
        token: {
          type: "string",
          description: "Token symbol (e.g. 'USDC').",
        },
        recipient: {
          type: "string",
          description: "Recipient wallet address.",
        },
        domain: {
          type: "string",
          description: "Domain or host of the target resource.",
        },
        coSigned: {
          type: "boolean",
          description: "Whether this transaction has a root or human co-signature.",
        },
      },
      required: ["amount"],
    },
  },
  {
    name: "arcenpay_revoke_mandate",
    description:
      "Revokes an active mandate locally and notifies the facilitator/registry to prevent further authorization.",
    inputSchema: {
      type: "object",
      properties: {
        mandateId: {
          type: "string",
          description: "Identifier of the mandate to revoke.",
        },
        reason: {
          type: "string",
          description: "Optional reason for revocation.",
        },
      },
      required: ["mandateId"],
    },
  },
  {
    name: "arcenpay_mandate_status",
    description:
      "Queries active delegation state, remaining depth, root issuer, and revocation status for a mandate.",
    inputSchema: {
      type: "object",
      properties: {
        mandateId: {
          type: "string",
          description: "Mandate ID to inspect (defaults to agent's current mandate).",
        },
      },
    },
  },
  {
    name: "arcenpay_fetch_escrowed",
    description:
      "Executes an escrow-protected x402 resource fetch. Funds are reserved in escrow and only released if the provider returns deliverable conforming to the commitment terms.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL of the escrow-protected resource to fetch.",
        },
        mode: {
          type: "string",
          enum: ["exact_hash", "schema_conformance", "attestation"],
          description: "Escrow verification mode (defaults to 'exact_hash').",
        },
        schemaDescriptor: {
          type: "object",
          description: "JSON schema descriptor when using schema_conformance mode.",
        },
        maxPrice: {
          type: "string",
          description: "Maximum price willing to spend (e.g. '1.00').",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "arcenpay_verify_commitment",
    description:
      "Cryptographically verifies whether a delivered payload matches a provider's commitment (exact_hash SHA-256 or schema conformance).",
    inputSchema: {
      type: "object",
      properties: {
        commitment: {
          type: "object",
          description: "Provider commitment object containing hash/schema reference and signature.",
        },
        payload: {
          description: "Delivered data or response payload to verify.",
        },
        schemaDescriptor: {
          type: "object",
          description: "Schema descriptor if verifying under schema_conformance mode.",
        },
      },
      required: ["commitment", "payload"],
    },
  },
  {
    name: "arcenpay_dispute_claim",
    description:
      "Automatically files a settlement dispute and triggers refund on failure or mismatch of deliverable.",
    inputSchema: {
      type: "object",
      properties: {
        requestNonce: {
          type: "string",
          description: "Request nonce of the disputed escrow reservation.",
        },
        failureReason: {
          type: "string",
          enum: [
            "hash_mismatch",
            "schema_violation",
            "timeout",
            "bad_signature",
            "malformed_commitment",
          ],
          description: "Reason for the dispute.",
        },
        schemaViolationDetail: {
          type: "string",
          description: "Optional description of schema violation error.",
        },
        actualPayloadHash: {
          type: "string",
          description: "Optional SHA-256 hash of the actual delivered payload.",
        },
      },
      required: ["requestNonce", "failureReason"],
    },
  },
  {
    name: "arcenpay_settlement_status",
    description:
      "Checks the current lifecycle status of an escrow reservation (reserved, released, refunded, disputed) by requestNonce.",
    inputSchema: {
      type: "object",
      properties: {
        requestNonce: {
          type: "string",
          description: "Escrow request nonce to check.",
        },
      },
      required: ["requestNonce"],
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

          case "arcenpay_issue_mandate": {
            const childAgentId = String(args.childAgentId ?? "");
            const childPublicKey = String(args.childPublicKey ?? "");
            if (!childAgentId || !childPublicKey) {
              return {
                isError: true,
                content: [{ type: "text", text: "Missing childAgentId or childPublicKey" }],
              };
            }
            const scope: MandateScope = {
              maxPerTxn: args.maxPerTxn ? String(args.maxPerTxn) : undefined,
              maxDaily: args.maxDaily ? String(args.maxDaily) : undefined,
              maxTotal: args.maxTotal ? String(args.maxTotal) : undefined,
              allowedTokens: Array.isArray(args.allowedTokens) ? args.allowedTokens.map(String) : ["USDC", "USDT"],
              allowedRecipients: Array.isArray(args.allowedRecipients) ? args.allowedRecipients.map(String) : ["*"],
              allowedResourceDomains: Array.isArray(args.allowedDomains) ? args.allowedDomains.map(String) : undefined,
              validFrom: args.validFrom ? String(args.validFrom) : new Date().toISOString(),
              validUntil: args.validUntil
                ? String(args.validUntil)
                : new Date(Date.now() + 30 * 86400000).toISOString(),
            };
            const mandate = await agent.issueMandate({
              childAgentId,
              childPublicKey,
              childScope: scope,
              isSubMandate: args.isSubMandate !== undefined ? Boolean(args.isSubMandate) : undefined,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(mandate, null, 2) }],
            };
          }

          case "arcenpay_check_policy": {
            const amount = String(args.amount ?? "0");
            const result = agent.checkPolicy({
              tx: {
                amount,
                amountAtomic: BigInt(Math.round(parseFloat(amount || "0") * 1_000_000)),
                token: String(args.token ?? "USDC"),
                recipient: String(args.recipient ?? agent.address),
                chainId: agent.chainId,
              },
              resource: args.domain ? { domain: String(args.domain), url: `https://${args.domain}` } : undefined,
              coSigned: Boolean(args.coSigned),
            });
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }

          case "arcenpay_revoke_mandate": {
            const mandateId = String(args.mandateId ?? "");
            if (!mandateId) {
              return {
                isError: true,
                content: [{ type: "text", text: "Missing mandateId" }],
              };
            }
            const res = await agent.revokeMandate(mandateId, args.reason ? String(args.reason) : undefined);
            return {
              content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
            };
          }

          case "arcenpay_mandate_status": {
            const mandateId = args.mandateId ? String(args.mandateId) : undefined;
            const status = await agent.getMandateStatus(mandateId);
            return {
              content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
            };
          }

          case "arcenpay_fetch_escrowed": {
            const url = String(args.url ?? "");
            if (!url) {
              return {
                isError: true,
                content: [{ type: "text", text: "Missing url" }],
              };
            }
            const escrowResult = await agent.fetchEscrowed(url, {
              mode: args.mode as EscrowMode | undefined,
              schemaDescriptor: args.schemaDescriptor as Record<string, unknown> | undefined,
              maxPrice: args.maxPrice ? String(args.maxPrice) : undefined,
            });
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      verified: escrowResult.verified,
                      payload: escrowResult.payload,
                      commitment: escrowResult.commitment,
                      disputeReceipt: escrowResult.disputeReceipt,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          case "arcenpay_verify_commitment": {
            const commitment = args.commitment as ProviderCommitment;
            const payload = args.payload;
            if (!commitment) {
              return {
                isError: true,
                content: [{ type: "text", text: "Missing commitment object" }],
              };
            }
            const verification = agent.verifyCommitment(
              commitment,
              payload,
              args.schemaDescriptor as Record<string, unknown> | undefined,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(verification, null, 2) }],
            };
          }

          case "arcenpay_dispute_claim": {
            const requestNonce = String(args.requestNonce ?? "");
            const failureReason = args.failureReason as DisputeReason;
            if (!requestNonce || !failureReason) {
              return {
                isError: true,
                content: [{ type: "text", text: "Missing requestNonce or failureReason" }],
              };
            }
            const receipt = await agent.disputeSettlement(requestNonce, {
              failureReason,
              schemaViolationDetail: args.schemaViolationDetail ? String(args.schemaViolationDetail) : undefined,
              actualPayloadHash: args.actualPayloadHash ? String(args.actualPayloadHash) : undefined,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }],
            };
          }

          case "arcenpay_settlement_status": {
            const requestNonce = String(args.requestNonce ?? "");
            if (!requestNonce) {
              return {
                isError: true,
                content: [{ type: "text", text: "Missing requestNonce" }],
              };
            }
            const status = await agent.getSettlementStatus(requestNonce);
            return {
              content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
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
