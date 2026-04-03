/**
 * ArcenClient — Node.js SDK for the ArcenPay Protocol.
 *
 * Usage pattern (Schematic-style):
 *  1. Call identify() once per session → stores session token
 *  2. Call checkFlag() / checkEntitlement() / track() with no keys
 */

import type {
  ArcenCompanyKeys,
  ArcenUserKeys,
  ArcenCompany,
  EmbedAccessTokenResponse,
  FlagResult,
  EntitlementResult,
  IdentifyResult,
} from '@arcenpay/sdk';

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
}

export interface IdentifyInput {
  company?: ArcenCompanyKeys & { name?: string; traits?: Record<string, unknown> };
  user?: ArcenUserKeys & { name?: string; email?: string };
  expiresIn?: number;
}

export interface ActivateSubscriptionInput {
  planId: string | number | bigint;
  paymentAccount: string;
  company: ArcenCompanyKeys & { name?: string; traits?: Record<string, unknown> };
  subscriberEmail?: string;
}

export interface ActivateSubscriptionResult {
  tokenId: string;
  txHash: string;
  companyId: string;
  planId: string;
  paymentAccount: string;
}

// Shape of the raw API response from /api/v1/access-tokens
interface AccessTokenApiResponse {
  token: string;
  company_id: string;
  user_id?: string;
  expires_at: number;
}

export class ArcenClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private session: { token: string; companyId: string; userId?: string } | null = null;

  constructor(config: ArcenClientConfig) {
    if (!config.apiKey.startsWith('api_')) {
      throw new Error('ArcenClient: apiKey must start with "api_"');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://dashboard.arcenpay.xyz').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  private buildAuthHeader(): string {
    return this.session ? `Bearer ${this.session.token}` : `Bearer ${this.apiKey}`;
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
      Authorization: options.useApiKey ? `Bearer ${this.apiKey}` : this.buildAuthHeader(),
      'Content-Type': 'application/json',
    };

    if (!this.session || options.useApiKey) {
      if (options.companyKeys) {
        const parts: string[] = [];
        if (options.companyKeys.id) parts.push(`id=${options.companyKeys.id}`);
        if (options.companyKeys.wallet) parts.push(`wallet=${options.companyKeys.wallet}`);
        if (options.companyKeys.email) parts.push(`email=${options.companyKeys.email}`);
        if (parts.length > 0) headers['X-Arcen-Company-Keys'] = parts.join(',');
      }
      if (options.userKeys) {
        const parts: string[] = [];
        if (options.userKeys.id) parts.push(`id=${options.userKeys.id}`);
        if (options.userKeys.clerkUserId) parts.push(`clerk_user_id=${options.userKeys.clerkUserId}`);
        if (options.userKeys.wallet) parts.push(`wallet=${options.userKeys.wallet}`);
        if (parts.length > 0) headers['X-Arcen-User-Keys'] = parts.join(',');
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const json = await res.json() as T & { error?: string };

      if (!res.ok) {
        throw new ArcenApiError(
          (json as { error?: string }).error ?? `HTTP ${res.status}`,
          res.status,
        );
      }

      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  async identify(input: IdentifyInput): Promise<IdentifyResult> {
    const res = await this.request<{ data: AccessTokenApiResponse }>(
      'POST',
      '/api/v1/access-tokens',
      {
        useApiKey: true,
        body: {
          company: input.company,
          user: input.user ? {
            id: input.user.id,
            clerk_user_id: input.user.clerkUserId,
            wallet: input.user.wallet,
            name: input.user.name,
            email: input.user.email,
          } : undefined,
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
    const input: TrackEventInput = typeof event === 'string' ? { name: event } : event;
    await this.request('POST', '/api/v1/events', {
      useApiKey: true,
      body: {
        event_type: 'track',
        name: input.name,
        company: input.company ?? (this.session ? { id: this.session.companyId } : undefined),
        traits: input.traits,
      },
    });
  }

  async checkFlag(key: string, companyKeys?: ArcenCompanyKeys, userKeys?: ArcenUserKeys): Promise<FlagResult> {
    return this.request<FlagResult>(
      'GET',
      '/api/v1/check',
      { query: { key }, companyKeys, userKeys },
    );
  }

  async checkEntitlement(key: string, companyKeys?: ArcenCompanyKeys, userKeys?: ArcenUserKeys): Promise<EntitlementResult> {
    return this.request<EntitlementResult>(
      'GET',
      '/api/v1/check',
      { query: { key }, companyKeys, userKeys },
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

  async listCompanies(options: { limit?: number; search?: string; cursor?: string } = {}): Promise<{
    data: ArcenCompany[];
    count: number;
    nextCursor?: string;
  }> {
    const query: Record<string, string> = {};
    if (options.limit) query.limit = String(options.limit);
    if (options.search) query.search = options.search;
    if (options.cursor) query.cursor = options.cursor;
    return this.request('GET', '/api/v1/companies', { useApiKey: true, query });
  }

  async getCompany(id: string): Promise<{ data: ArcenCompany & { entitlements: unknown[] } }> {
    return this.request('GET', `/api/v1/companies/${id}`, { useApiKey: true });
  }

  async createCompany(data: {
    name: string;
    wallet?: string;
    email?: string;
    id?: string;
    traits?: Record<string, unknown>;
  }): Promise<{ data: ArcenCompany }> {
    return this.request('POST', '/api/v1/companies', { useApiKey: true, body: data });
  }

  async updateCompany(
    id: string,
    data: { name?: string; traits?: Record<string, unknown>; activePlanId?: string | null },
  ): Promise<{ data: ArcenCompany }> {
    return this.request('PATCH', `/api/v1/companies/${id}`, { useApiKey: true, body: data });
  }

  async setCompanyOverride(companyId: string, featureKey: string, value: boolean, reason?: string): Promise<void> {
    await this.request('POST', `/api/v1/companies/${companyId}/overrides`, {
      useApiKey: true,
      body: { featureKey, value, reason },
    });
  }

  async activateSubscription(
    input: ActivateSubscriptionInput,
  ): Promise<ActivateSubscriptionResult> {
    const res = await this.request<{ data: ActivateSubscriptionResult }>(
      'POST',
      '/api/v1/subscriptions/activate',
      {
        useApiKey: true,
        body: {
          planId:
            typeof input.planId === 'bigint'
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
    const res = await this.request<{ data: EmbedAccessTokenResponse }>(
      'POST',
      '/api/v1/access-tokens',
      {
        useApiKey: true,
        body: {
          company: companyKeys,
          user: userKeys ? {
            id: userKeys.id,
            clerk_user_id: userKeys.clerkUserId,
            wallet: userKeys.wallet,
          } : undefined,
          expires_in: expiresIn,
        },
      },
    );
    return res.data;
  }
}

export class ArcenApiError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'ArcenApiError';
  }
}
