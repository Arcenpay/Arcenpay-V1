/**
 * ArcenClient — Node.js SDK for the ArcenPay Protocol.
 *
 * Usage pattern (Schematic-style):
 *  1. Call identify() once per session → stores session token
 *  2. Call checkFlag() / checkEntitlement() / track() with no keys
 */

import { randomUUID } from "node:crypto";

import type {
  ArcenCompanyKeys,
  ArcenUserKeys,
  ArcenCompany,
  EmbedAccessTokenResponse,
  FlagResult,
  EntitlementResult,
  ConsumeEntitlementResult,
  IdentifyResult,
} from "./sdk";
import { resolveArcenPayBaseUrl, resolveTokenAddress } from "./sdk";

export interface ArcenClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface TrackEventInput {
  name: string;
  company?: ArcenCompanyKeys;
  user?: ArcenUserKeys;
  traits?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface IdentifyInput {
  company?: ArcenCompanyKeys & {
    name?: string;
    traits?: Record<string, unknown>;
  };
  user?: ArcenUserKeys & { name?: string; email?: string };
  expiresIn?: number;
}

export interface ActivateSubscriptionInput {
  planId: string | number | bigint;
  paymentAccount: string;
  company: ArcenCompanyKeys & {
    name?: string;
    traits?: Record<string, unknown>;
  };
  subscriberEmail?: string;
}

export interface ActivateSubscriptionResult {
  tokenId: string;
  txHash: string;
  companyId: string;
  planId: string;
  paymentAccount: string;
}

export interface ConsumeEntitlementInput {
  featureKey: string;
  company?: ArcenCompanyKeys;
  user?: ArcenUserKeys;
  traits?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface PaymentLinkSummary {
  id: string;
  name: string;
  slug: string;
  kind: "ADDON" | "INVOICE" | "CUSTOM";
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  amount: string;
  currency: string;
  acceptedToken: string;
  recipientWallet: string;
  chainId: number;
  checkoutUrl: string;
  isAgentic?: boolean;
  agenticSpecUrl?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  successUrl?: string | null;
  cancelUrl?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
  company?: {
    id: string;
    name: string;
    email: string | null;
    walletAddress: string | null;
    logoUrl?: string | null;
  } | null;
  catalogAddOn?: {
    id: string;
    name: string;
    code?: string | null;
    billingType?: string | null;
    saleMode?: string | null;
  } | null;
  invoice?: {
    id: string;
    number?: string | null;
    status?: string | null;
    total?: string | null;
    currency?: string | null;
  } | null;
}

export interface CreatePaymentLinkInput {
  kind: "ADDON" | "INVOICE" | "CUSTOM";
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  companyId?: string;
  catalogAddOnId?: string;
  invoiceId?: string;
  amount?: number;
  /** Token address or symbol ("USDC", "USDT") — symbols resolve against the chain registry. */
  acceptedToken?: string;
  /** Display currency label. Defaults to "USDC" on the backend. */
  currency?: string;
  /** Chain the link settles on. Falls back to the team's default chain. */
  chainId?: number;
  /** Enable dual-mode agentic /spec resolution for autonomous checkout. */
  isAgentic?: boolean;
  recipientWallet: string;
  successUrl?: string;
  cancelUrl?: string;
  /** ISO-8601 expiry timestamp, e.g. new Date(...).toISOString(). */
  expiresAt?: string;
}

export interface UpdatePaymentLinkInput {
  status?: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  name?: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  recipientWallet?: string;
  successUrl?: string | null;
  cancelUrl?: string | null;
  expiresAt?: string | null;
}

export interface CheckoutSessionSummary {
  id: string;
  purpose: "ADDON" | "INVOICE" | "CUSTOM";
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED" | "FAILED";
  customerEmail?: string | null;
  customerWallet?: string | null;
  customerName?: string | null;
  amount: string;
  currency: string;
  acceptedToken?: string;
  recipientWallet?: string;
  txHash?: string | null;
  verificationError?: string | null;
  createdAt?: string;
  paidAt?: string | null;
  paymentLink?: {
    id: string;
    name: string;
    slug: string;
    kind: string;
  } | null;
  company?: {
    id: string;
    name: string;
    email: string | null;
    walletAddress: string | null;
  } | null;
  payment?: {
    id: string;
    status: string;
    txHash: string;
    amount: string;
    currency: string;
  } | null;
}

export interface CreateCheckoutSessionInput {
  paymentLinkId?: string;
  purpose?: "ADDON" | "INVOICE" | "CUSTOM";
  companyId?: string;
  catalogAddOnId?: string;
  invoiceId?: string;
  customerEmail?: string;
  customerWallet?: string;
  customerName?: string;
  amount?: number;
  acceptedToken?: string;
  recipientWallet?: string;
  successUrl?: string;
  cancelUrl?: string;
  expiresAt?: string;
}

export interface ChargeCustomerInput {
  /** Amount in USDC (e.g., 49.99) */
  amount: number;
  /** Wallet address that receives the payment */
  recipientWallet: string;
  /** Display name for the payment link */
  name: string;
  /**
   * Chain the charge settles on. Accepts EVM, Stellar and Solana synthetic
   * chain ids (e.g. 9_100_001 for Solana devnet). Omit to use the team default.
   */
  chainId?: number;
  /** Optional description shown on checkout */
  description?: string;
  /** Company to associate this charge with */
  company?: {
    id?: string;
    name?: string;
    email?: string;
    wallet?: string;
  };
  /** Customer receiving the checkout link */
  customer?: {
    email?: string;
    wallet?: string;
    name?: string;
  };
  /** URL to redirect after successful payment */
  successUrl?: string;
  /** URL to redirect if customer cancels */
  cancelUrl?: string;
  /** Checkout page appearance customization */
  appearance?: {
    title?: string;
    description?: string;
    brandName?: string;
    recipientName?: string;
    buttonLabel?: string;
    accentColor?: string;
    logoUrl?: string;
  };
  /** Session expiration in seconds (default: 3600 = 1 hour) */
  expiresInSeconds?: number;
  /** Unique key to prevent duplicate charges */
  idempotencyKey?: string;
}

export interface ChargeCustomerResult {
  /** The hosted checkout URL the customer should visit */
  checkoutUrl: string;
  /** The payment link ID for reference */
  paymentLinkId: string;
  /** The checkout session ID */
  sessionId: string;
  /** When this session expires */
  expiresAt: string;
  /** The payment link slug */
  slug: string;
  /** Idempotency key used for this charge */
  idempotencyKey: string;
}

export interface HostedCheckoutInput {
  /** Payment link slug or ID */
  paymentLinkSlug?: string;
  paymentLinkId?: string;
  /** Customer details */
  customer?: {
    email?: string;
    wallet?: string;
    name?: string;
  };
  /** Override success/cancel URLs for this session */
  successUrl?: string;
  cancelUrl?: string;
  /** Session expiration in seconds (default: 3600 = 1 hour) */
  expiresInSeconds?: number;
  /** Unique key to prevent duplicate checkouts */
  idempotencyKey?: string;
}

export interface HostedCheckoutResult {
  /** Full URL to redirect the customer to */
  checkoutUrl: string;
  /** Session ID for status tracking */
  sessionId: string;
  /** When this session expires */
  expiresAt: string;
  /** Idempotency key used for this checkout */
  idempotencyKey: string;
}

// Shape of the raw API response from /api/v1/access-tokens
interface AccessTokenApiResponse {
  token: string;
  company_id: string;
  user_id?: string;
  expires_at: string;
}

export class ArcenClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private session: {
    token: string;
    companyId: string;
    userId?: string;
  } | null = null;

  constructor(config: ArcenClientConfig) {
    const supportedPrefixes = [
      "sk_live_",
      "sk_test_",
      "pk_live_",
      "pk_test_",
      "rk_live_",
      "rk_test_",
    ];
    if (!supportedPrefixes.some((prefix) => config.apiKey.startsWith(prefix))) {
      throw new Error(
        'ArcenClient: apiKey must start with sk_live_, sk_test_, pk_live_, pk_test_, rk_live_ or rk_test_ (legacy api_ keys are no longer supported — regenerate as sk_/pk_/rk_)',
      );
    }
    this.apiKey = config.apiKey;
    this.baseUrl = resolveArcenPayBaseUrl({ explicit: config.baseUrl });
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  private buildAuthHeader(): string {
    return this.session
      ? `Bearer ${this.session.token}`
      : `Bearer ${this.apiKey}`;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      companyKeys?: ArcenCompanyKeys;
      userKeys?: ArcenUserKeys;
      query?: Record<string, string>;
      useApiKey?: boolean;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      Authorization: options.useApiKey
        ? `Bearer ${this.apiKey}`
        : this.buildAuthHeader(),
      "Content-Type": "application/json",
    };

    if (!this.session || options.useApiKey) {
      if (options.companyKeys) {
        const parts: string[] = [];
        if (options.companyKeys.id) parts.push(`id=${options.companyKeys.id}`);
        if (options.companyKeys.wallet)
          parts.push(`wallet=${options.companyKeys.wallet}`);
        if (options.companyKeys.email)
          parts.push(`email=${options.companyKeys.email}`);
        if (parts.length > 0) headers["X-Arcen-Company-Keys"] = parts.join(",");
      }
      if (options.userKeys) {
        const parts: string[] = [];
        if (options.userKeys.id) parts.push(`id=${options.userKeys.id}`);
        if (options.userKeys.clerkUserId)
          parts.push(`clerk_user_id=${options.userKeys.clerkUserId}`);
        if (options.userKeys.wallet)
          parts.push(`wallet=${options.userKeys.wallet}`);
        if (parts.length > 0) headers["X-Arcen-User-Keys"] = parts.join(",");
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method,
        headers,
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      let json: (T & { error?: string }) | undefined;
      try {
        json = (await res.json()) as T & { error?: string };
      } catch {
        throw new ArcenApiError(
          `Invalid JSON response from ${method} ${path}`,
          res.status,
        );
      }

      if (!res.ok) {
        throw new ArcenApiError(json.error ?? `HTTP ${res.status}`, res.status);
      }

      return json;
    } catch (err) {
      if (err instanceof ArcenApiError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ArcenApiError(
          `Request timed out after ${this.timeoutMs}ms`,
          408,
        );
      }
      throw new ArcenApiError(
        err instanceof Error ? err.message : "Network request failed",
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async identify(input: IdentifyInput): Promise<IdentifyResult> {
    const res = await this.request<{ data: AccessTokenApiResponse }>(
      "POST",
      "/api/v1/access-tokens",
      {
        useApiKey: true,
        body: {
          company: input.company,
          user: input.user
            ? {
                id: input.user.id,
                clerk_user_id: input.user.clerkUserId,
                wallet: input.user.wallet,
                name: input.user.name,
                email: input.user.email,
              }
            : undefined,
          expires_in: input.expiresIn ?? 3600,
        },
      },
    );

    const data = res.data;
    this.session = {
      token: data.token,
      companyId: data.company_id,
      userId: data.user_id,
    };

    return {
      token: data.token,
      companyId: data.company_id,
      userId: data.user_id,
      expiresAt: data.expires_at,
    };
  }

  async track(event: string | TrackEventInput): Promise<void> {
    const input: TrackEventInput =
      typeof event === "string" ? { name: event } : event;
    await this.request("POST", "/api/v1/events", {
      useApiKey: this.session === null,
      body: {
        event_type: "track",
        name: input.name,
        ...(input.company ? { company: input.company } : {}),
        ...(input.user ? { user: input.user } : {}),
        traits: input.traits,
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
      },
    });
  }

  async consumeEntitlement(
    input: string | ConsumeEntitlementInput,
  ): Promise<ConsumeEntitlementResult> {
    const normalized: ConsumeEntitlementInput =
      typeof input === "string" ? { featureKey: input } : input;

    return this.request<ConsumeEntitlementResult>(
      "POST",
      "/api/v1/usage/consume",
      {
        useApiKey: this.session === null,
        companyKeys: normalized.company,
        userKeys: normalized.user,
        body: {
          featureKey: normalized.featureKey,
          traits: normalized.traits,
          ...(normalized.idempotencyKey
            ? { idempotencyKey: normalized.idempotencyKey }
            : {}),
        },
      },
    );
  }

  async checkFlag(
    key: string,
    companyKeys?: ArcenCompanyKeys,
    userKeys?: ArcenUserKeys,
  ): Promise<FlagResult> {
    return this.request<FlagResult>("GET", "/api/v1/check", {
      query: { key },
      companyKeys,
      userKeys,
    });
  }

  async checkEntitlement(
    key: string,
    companyKeys?: ArcenCompanyKeys,
    userKeys?: ArcenUserKeys,
  ): Promise<EntitlementResult> {
    return this.request<EntitlementResult>("GET", "/api/v1/check", {
      query: { key },
      companyKeys,
      userKeys,
    });
  }

  async listEntitlements(
    companyKeys?: ArcenCompanyKeys,
    userKeys?: ArcenUserKeys,
  ): Promise<Record<string, EntitlementResult>> {
    const result = await this.request<{ entitlements: EntitlementResult[] }>(
      "GET",
      "/api/v1/entitlements",
      {
        companyKeys,
        userKeys,
      },
    );

    return Object.fromEntries(
      result.entitlements.map((entitlement) => [entitlement.key, entitlement]),
    );
  }

  async checkFlags(
    featureKeys: string[],
    companyKeys?: ArcenCompanyKeys,
    userKeys?: ArcenUserKeys,
  ): Promise<Record<string, FlagResult>> {
    const results = await Promise.all(
      featureKeys.map((key) => this.checkFlag(key, companyKeys, userKeys)),
    );
    return Object.fromEntries(results.map((r) => [r.key, r]));
  }

  async listCompanies(
    options: { limit?: number; search?: string; cursor?: string } = {},
  ): Promise<{
    data: ArcenCompany[];
    count: number;
    nextCursor?: string;
  }> {
    const query: Record<string, string> = {};
    if (options.limit) query.limit = String(options.limit);
    if (options.search) query.search = options.search;
    if (options.cursor) query.cursor = options.cursor;
    return this.request("GET", "/api/v1/companies", { useApiKey: true, query });
  }

  async getCompany(
    id: string,
  ): Promise<{ data: ArcenCompany & { entitlements: unknown[] } }> {
    return this.request("GET", `/api/v1/companies/${id}`, { useApiKey: true });
  }

  async createCompany(data: {
    name: string;
    wallet?: string;
    email?: string;
    id?: string;
    traits?: Record<string, unknown>;
  }): Promise<{ data: ArcenCompany }> {
    return this.request("POST", "/api/v1/companies", {
      useApiKey: true,
      body: data,
    });
  }

  async updateCompany(
    id: string,
    data: {
      name?: string;
      traits?: Record<string, unknown>;
      activePlanId?: string | null;
    },
  ): Promise<{ data: ArcenCompany }> {
    return this.request("PATCH", `/api/v1/companies/${id}`, {
      useApiKey: true,
      body: data,
    });
  }

  async listPaymentLinks(): Promise<{ paymentLinks: PaymentLinkSummary[] }> {
    return this.request("GET", "/api/v1/payment-links", { useApiKey: true });
  }

  async getPaymentLink(id: string): Promise<{ paymentLink: PaymentLinkSummary }> {
    return this.request("GET", `/api/v1/payment-links/${id}`, {
      useApiKey: true,
    });
  }

  async createPaymentLink(
    input: CreatePaymentLinkInput,
  ): Promise<{ paymentLink: PaymentLinkSummary }> {
    // Symbols ("USDC", "USDT") are resolved to the chain's token address so
    // callers never need to hardcode contracts. Raw addresses pass through.
    let acceptedToken = input.acceptedToken;
    if (input.acceptedToken && input.chainId) {
      acceptedToken =
        resolveTokenAddress(input.chainId, input.acceptedToken) ?? input.acceptedToken;
    }

    return this.request("POST", "/api/v1/payment-links", {
      useApiKey: true,
      body: {
        ...input,
        ...(acceptedToken !== undefined ? { acceptedToken } : {}),
      },
    });
  }

  async updatePaymentLink(
    id: string,
    input: UpdatePaymentLinkInput,
  ): Promise<{ paymentLink: PaymentLinkSummary }> {
    return this.request("PATCH", `/api/v1/payment-links/${id}`, {
      useApiKey: true,
      body: input,
    });
  }

  async listCheckoutSessions(): Promise<{
    checkoutSessions: CheckoutSessionSummary[];
  }> {
    return this.request("GET", "/api/v1/checkout-sessions", {
      useApiKey: true,
    });
  }

  async getCheckoutSession(
    id: string,
  ): Promise<{ checkoutSession: CheckoutSessionSummary }> {
    return this.request("GET", `/api/v1/checkout-sessions/${id}`, {
      useApiKey: true,
    });
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<{ checkoutSession: CheckoutSessionSummary }> {
    return this.request("POST", "/api/v1/checkout-sessions", {
      useApiKey: true,
      body: input,
    });
  }

  async chargeCustomer(
    input: ChargeCustomerInput,
  ): Promise<ChargeCustomerResult> {
    const idempotencyKey = input.idempotencyKey || `idem_${Date.now()}_${randomUUID()}`;

    const appearanceMeta: Record<string, unknown> = {};
    if (input.appearance) {
      const appearance: Record<string, unknown> = {};
      if (input.appearance.title) appearance.title = input.appearance.title;
      if (input.appearance.description) appearance.description = input.appearance.description;
      if (input.appearance.brandName) appearance.brandName = input.appearance.brandName;
      if (input.appearance.recipientName) appearance.recipientName = input.appearance.recipientName;
      if (input.appearance.buttonLabel) appearance.buttonLabel = input.appearance.buttonLabel;
      if (input.appearance.accentColor) appearance.accentColor = input.appearance.accentColor;
      if (input.appearance.logoUrl) appearance.logoUrl = input.appearance.logoUrl;
      if (Object.keys(appearance).length > 0) {
        appearanceMeta.checkoutPage = appearance;
      }
    }
    appearanceMeta.idempotencyKey = idempotencyKey;

    const linkRes = await this.createPaymentLink({
      kind: "CUSTOM",
      name: input.name,
      description: input.description,
      amount: input.amount,
      recipientWallet: input.recipientWallet,
      chainId: input.chainId,
      companyId: input.company?.id,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      metadata: Object.keys(appearanceMeta).length > 0 ? appearanceMeta : undefined,
    });

    const sessionRes = await this.createCheckoutSession({
      paymentLinkId: linkRes.paymentLink.id,
      purpose: "CUSTOM",
      customerEmail: input.customer?.email,
      customerWallet: input.customer?.wallet,
      customerName: input.customer?.name,
      amount: input.amount,
      recipientWallet: input.recipientWallet,
      companyId: input.company?.id,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      expiresAt: input.expiresInSeconds
        ? new Date(Date.now() + input.expiresInSeconds * 1000).toISOString()
        : undefined,
    });

    return {
      checkoutUrl: `${this.baseUrl}/pay/${linkRes.paymentLink.slug}?session=${sessionRes.checkoutSession.id}`,
      paymentLinkId: linkRes.paymentLink.id,
      sessionId: sessionRes.checkoutSession.id,
      expiresAt: sessionRes.checkoutSession.createdAt
        ? new Date(new Date(sessionRes.checkoutSession.createdAt).getTime() + (input.expiresInSeconds ?? 3600) * 1000).toISOString()
        : new Date(Date.now() + (input.expiresInSeconds ?? 3600) * 1000).toISOString(),
      slug: linkRes.paymentLink.slug,
      idempotencyKey,
    };
  }

  async createHostedCheckout(
    input: HostedCheckoutInput,
  ): Promise<HostedCheckoutResult> {
    const idempotencyKey = input.idempotencyKey || `idem_${Date.now()}_${randomUUID()}`;

    let slug = input.paymentLinkSlug;

    if (!slug && input.paymentLinkId) {
      const link = await this.getPaymentLink(input.paymentLinkId);
      slug = link.paymentLink.slug;
    }

    if (!slug) {
      throw new ArcenApiError("Either paymentLinkSlug or paymentLinkId is required", 400);
    }

    const sessionRes = await this.createCheckoutSession({
      paymentLinkId: input.paymentLinkId,
      purpose: "CUSTOM",
      customerEmail: input.customer?.email,
      customerWallet: input.customer?.wallet,
      customerName: input.customer?.name,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      expiresAt: input.expiresInSeconds
        ? new Date(Date.now() + input.expiresInSeconds * 1000).toISOString()
        : undefined,
    });

    return {
      checkoutUrl: `${this.baseUrl}/pay/${slug}?session=${sessionRes.checkoutSession.id}`,
      sessionId: sessionRes.checkoutSession.id,
      expiresAt: sessionRes.checkoutSession.createdAt
        ? new Date(new Date(sessionRes.checkoutSession.createdAt).getTime() + (input.expiresInSeconds ?? 3600) * 1000).toISOString()
        : new Date(Date.now() + (input.expiresInSeconds ?? 3600) * 1000).toISOString(),
      idempotencyKey,
    };
  }

  async getCheckoutSessionStatus(
    sessionId: string,
  ): Promise<{ status: string; expiresAt?: string; paidAt?: string }> {
    const res = await this.getCheckoutSession(sessionId);
    return {
      status: res.checkoutSession.status,
      expiresAt: res.checkoutSession.createdAt,
      paidAt: res.checkoutSession.paidAt ?? undefined,
    };
  }

  async regenerateCheckoutSession(
    paymentLinkId: string,
    options?: { expiresInSeconds?: number },
  ): Promise<HostedCheckoutResult> {
    const idempotencyKey = `idem_${Date.now()}_${randomUUID()}`;
    const link = await this.getPaymentLink(paymentLinkId);
    const result = await this.createHostedCheckout({
      paymentLinkSlug: link.paymentLink.slug,
      paymentLinkId,
      expiresInSeconds: options?.expiresInSeconds ?? 3600,
    });
    return {
      ...result,
      idempotencyKey,
    };
  }

  async setCompanyOverride(
    companyId: string,
    featureKey: string,
    value: boolean,
    reason?: string,
  ): Promise<void> {
    await this.request("POST", `/api/v1/companies/${companyId}/overrides`, {
      useApiKey: true,
      body: { featureKey, value, reason },
    });
  }

  async activateSubscription(
    input: ActivateSubscriptionInput,
  ): Promise<ActivateSubscriptionResult> {
    const res = await this.request<{ data: ActivateSubscriptionResult }>(
      "POST",
      "/api/v1/subscriptions/activate",
      {
        useApiKey: true,
        body: {
          planId:
            typeof input.planId === "bigint"
              ? input.planId.toString()
              : String(input.planId),
          paymentAccount: input.paymentAccount,
          company: input.company,
          ...(input.subscriberEmail
            ? { subscriberEmail: input.subscriberEmail }
            : {}),
        },
      },
    );

    return res.data;
  }

  /** @deprecated Use identify() instead */
  async createAccessToken(
    companyKeys?: ArcenCompanyKeys,
    userKeys?: ArcenUserKeys,
    expiresIn = 3600,
  ): Promise<EmbedAccessTokenResponse> {
    const res = await this.request<{ data: AccessTokenApiResponse }>(
      "POST",
      "/api/v1/access-tokens",
      {
        useApiKey: true,
        body: {
          company: companyKeys,
          user: userKeys
            ? {
                id: userKeys.id,
                clerk_user_id: userKeys.clerkUserId,
                wallet: userKeys.wallet,
              }
            : undefined,
          expires_in: expiresIn,
        },
      },
    );
    return {
      token: res.data.token,
      expiresAt: res.data.expires_at,
    };
  }
}

export class ArcenApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "ArcenApiError";
  }
}
