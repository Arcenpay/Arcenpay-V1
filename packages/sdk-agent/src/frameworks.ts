// ============================================================
//  @arcenpay/agent — Multi-Framework Adapters
//  First-class adapters for LangChain, Vercel AI SDK, OpenAI,
//  and Anthropic Claude tool calling.
// ============================================================

import { formatUnits } from "viem";
import type { ArcenAgent } from "./agent";
import type {
  CreateAgentPaymentLinkParams,
  PayPaymentLinkOptions,
} from "./internal/core";

// ─── Tool Definitions & Schemas ──────────────────────────────────────────────

export interface AgentToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const ARCENPAY_AGENT_TOOL_SCHEMAS: readonly AgentToolSchema[] = [
  {
    name: "arcenpay_check_balance",
    description:
      "Checks the agent's available on-chain balance (ArcenPay Session Vault, Stellar Horizon, or direct wallet token balance). Returns balances in both USDC and atomic units.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "arcenpay_fund_session",
    description:
      "Pre-funds or deposits USDC into an ArcenPay session vault to enable autonomous micro-payments.",
    parameters: {
      type: "object",
      properties: {
        amount: {
          type: "string",
          description: "Amount of USDC to deposit (e.g. '5.00').",
        },
      },
      required: ["amount"],
    },
  },
  {
    name: "arcenpay_resolve_payment_link",
    description:
      "Discovers and inspects an ArcenPay payment link (by URL or slug) to verify pricing, currency, recipient, and status before paying.",
    parameters: {
      type: "object",
      properties: {
        urlOrSlug: {
          type: "string",
          description: "Full ArcenPay checkout URL or payment link slug.",
        },
      },
      required: ["urlOrSlug"],
    },
  },
  {
    name: "arcenpay_pay_payment_link",
    description:
      "Executes an autonomous cryptocurrency payment for an ArcenPay payment link within configured budget limits.",
    parameters: {
      type: "object",
      properties: {
        urlOrSlug: {
          type: "string",
          description: "Full ArcenPay checkout URL or payment link slug.",
        },
        maxPrice: {
          type: "string",
          description: "Optional safety ceiling in decimal USDC (e.g. '1.50').",
        },
        customerName: {
          type: "string",
          description: "Optional name of the paying customer or agent.",
        },
        customerEmail: {
          type: "string",
          description: "Optional email to receive receipt.",
        },
      },
      required: ["urlOrSlug"],
    },
  },
  {
    name: "arcenpay_create_payment_link",
    description:
      "Creates a new agentic payment link so this agent can accept cryptocurrency payments for APIs or inferences.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the item or service.",
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
          description: "Chain ID for payment settlement.",
        },
        recipientWallet: {
          type: "string",
          description: "Payout wallet address.",
        },
      },
      required: ["title", "amount"],
    },
  },
  {
    name: "arcenpay_fetch",
    description:
      "Performs an autonomous HTTP request to an x402 payment-gated API. If a 402 challenge is returned, automatically negotiates and signs payment.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The target API URL.",
        },
        maxPrice: {
          type: "string",
          description: "Maximum price willing to spend (e.g. '0.05').",
        },
        method: {
          type: "string",
          description: "HTTP method (GET, POST, etc.). Defaults to GET.",
        },
        headers: {
          type: "object",
          description: "Optional HTTP headers.",
        },
        body: {
          type: "string",
          description: "Optional request body.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "arcenpay_get_spend_summary",
    description:
      "Retrieves the agent's current spend summary (daily spent, total spent, daily budget ceiling, and auto-approve threshold).",
    parameters: {
      type: "object",
      properties: {},
    },
  },
] as const;

// ─── Central Tool Execution Dispatcher ────────────────────────────────────────

/**
 * Dispatches an ArcenPay tool execution against an initialized ArcenAgent instance.
 * Normalizes arguments and returns structured JSON-compatible results.
 */
export async function executeArcenAgentTool(
  agent: ArcenAgent,
  name: string,
  rawArgs: unknown,
): Promise<any> {
  const args: Record<string, any> =
    typeof rawArgs === "string"
      ? (() => {
          try {
            return JSON.parse(rawArgs);
          } catch {
            return { input: rawArgs };
          }
        })()
      : typeof rawArgs === "object" && rawArgs !== null
      ? (rawArgs as Record<string, any>)
      : {};

  switch (name) {
    case "arcenpay_check_balance": {
      const balance = await agent.getBalance();
      return {
        balanceAtomic: balance.toString(),
        balanceUsdc: formatUnits(balance, 6),
        address: agent.address,
        isStellar: agent.isStellar,
      };
    }

    case "arcenpay_fund_session": {
      const amount = String(args.amount ?? "");
      if (!amount) {
        throw new Error("Missing required parameter 'amount' (e.g. '5.00')");
      }
      const sessionId = await agent.fundSession(amount);
      return {
        sessionId,
        fundedAmountUsdc: amount,
        address: agent.address,
      };
    }

    case "arcenpay_resolve_payment_link": {
      const urlOrSlug = String(args.urlOrSlug ?? args.input ?? "");
      if (!urlOrSlug) {
        throw new Error("Missing required parameter 'urlOrSlug'");
      }
      return await agent.resolvePaymentLink(urlOrSlug);
    }

    case "arcenpay_pay_payment_link": {
      const urlOrSlug = String(args.urlOrSlug ?? args.input ?? "");
      if (!urlOrSlug) {
        throw new Error("Missing required parameter 'urlOrSlug'");
      }
      const options: PayPaymentLinkOptions = {
        maxPrice: args.maxPrice ? String(args.maxPrice) : undefined,
        customerName: args.customerName ? String(args.customerName) : undefined,
        customerEmail: args.customerEmail ? String(args.customerEmail) : undefined,
      };
      return await agent.payPaymentLink(urlOrSlug, options);
    }

    case "arcenpay_create_payment_link": {
      const title = String(args.title ?? "");
      const amount = Number(args.amount);
      if (!title || isNaN(amount) || amount <= 0) {
        throw new Error("Title and a positive amount are required to create a payment link");
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
      return await agent.createPaymentLink(params);
    }

    case "arcenpay_fetch": {
      const url = String(args.url ?? args.input ?? "");
      if (!url) {
        throw new Error("Missing required parameter 'url'");
      }
      const res = await agent.fetch(url, {
        maxPrice: args.maxPrice ? String(args.maxPrice) : undefined,
        autoApprove: true,
        method: args.method ? String(args.method) : "GET",
        headers: args.headers as Record<string, string> | undefined,
        body: args.body ? String(args.body) : undefined,
      });

      const contentType = res.headers.get("content-type") || "";
      let body: any;
      if (contentType.includes("application/json")) {
        try {
          body = await res.json();
        } catch {
          body = null;
        }
      } else {
        try {
          body = await res.text();
        } catch {
          body = null;
        }
      }

      return {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
        body,
      };
    }

    case "arcenpay_get_spend_summary": {
      return agent.getSpendSummary();
    }

    default:
      throw new Error(`Unknown ArcenPay tool: '${name}'`);
  }
}

// ─── 1. LangChain Adapter ─────────────────────────────────────────────────────

export interface LangChainTool {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
  func: (input: any) => Promise<string>;
  call: (input: any) => Promise<string>;
  invoke: (input: any) => Promise<string>;
}

/**
 * Creates LangChain-compatible tools bound to the given ArcenAgent.
 * Usable with LangChain Agents, ToolNode, and LCEL chains.
 */
export function createArcenAgentLangChainTools(agent: ArcenAgent): LangChainTool[] {
  return ARCENPAY_AGENT_TOOL_SCHEMAS.map((schema) => {
    const execute = async (input: any): Promise<string> => {
      try {
        const result = await executeArcenAgentTool(agent, schema.name, input);
        return typeof result === "string" ? result : JSON.stringify(result, null, 2);
      } catch (err: any) {
        return JSON.stringify({ error: err?.message ?? String(err) });
      }
    };

    return {
      name: schema.name,
      description: schema.description,
      schema: schema.parameters,
      func: execute,
      call: execute,
      invoke: execute,
    };
  });
}

export const toLangChainTools = createArcenAgentLangChainTools;

// ─── 2. Vercel AI SDK Adapter ─────────────────────────────────────────────────

export interface VercelAITool<TParams = any, TResult = any> {
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (args: TParams) => Promise<TResult>;
}

/**
 * Creates tools formatted for the Vercel AI SDK (`ai` generateText, streamText).
 * Returns a dictionary keyed by tool name.
 */
export function createArcenAgentVercelAITools(
  agent: ArcenAgent,
): Record<string, VercelAITool> {
  const tools: Record<string, VercelAITool> = {};

  for (const schema of ARCENPAY_AGENT_TOOL_SCHEMAS) {
    tools[schema.name] = {
      description: schema.description,
      parameters: schema.parameters,
      execute: async (args: any) => {
        return await executeArcenAgentTool(agent, schema.name, args);
      },
    };
  }

  return tools;
}

export const toVercelTools = createArcenAgentVercelAITools;

// ─── 3. OpenAI Tools Adapter ──────────────────────────────────────────────────

export interface OpenAIFunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface OpenAITool {
  type: "function";
  function: OpenAIFunctionDefinition;
}

/**
 * Generates OpenAI standard function tool definitions for ChatCompletions.
 */
export function createArcenAgentOpenAITools(): OpenAITool[] {
  return ARCENPAY_AGENT_TOOL_SCHEMAS.map((schema) => ({
    type: "function" as const,
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }));
}

export const toOpenAITools = createArcenAgentOpenAITools;

/**
 * Executes a tool called by OpenAI ChatCompletions.
 */
export async function executeOpenAITool(
  agent: ArcenAgent,
  name: string,
  args: string | Record<string, unknown>,
): Promise<any> {
  return await executeArcenAgentTool(agent, name, args);
}

// ─── 4. Anthropic Claude Tools Adapter ────────────────────────────────────────

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Generates Anthropic Claude Messages API tool definitions.
 */
export function createArcenAgentAnthropicTools(): AnthropicTool[] {
  return ARCENPAY_AGENT_TOOL_SCHEMAS.map((schema) => ({
    name: schema.name,
    description: schema.description,
    input_schema: schema.parameters,
  }));
}

export const toAnthropicTools = createArcenAgentAnthropicTools;

/**
 * Executes a tool use block from Anthropic Claude Messages API.
 */
export async function executeAnthropicTool(
  agent: ArcenAgent,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  return await executeArcenAgentTool(agent, name, input);
}
