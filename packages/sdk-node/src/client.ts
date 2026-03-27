/**
 * ArcenClient — Node.js SDK for the ArcenPay Protocol.
 *
 * Use this in your backend to:
 *  - Track usage events
 *  - Identify companies and users
 *  - Check feature flags server-side
 *  - Generate access tokens for embeddable components
 *  - Manage companies programmatically
 *
 * @example
 * import { ArcenClient } from '@arcenpay/node';
 *
 * const arcen = new ArcenClient({
 *   apiKey: process.env.ARCEN_API_KEY!,
 *   baseUrl: 'https://dashboard.arcenpay.xyz',
 * });
 *
 * // Track usage
 * await arcen.track({ name: 'scan', company: { wallet: '0x...' } });
 *
 * // Check a flag
 * const { value } = await arcen.checkFlag('scan', { wallet: '0x...' });
 *
 * // Generate embed token
 * const token = await arcen.createAccessToken({ wallet: '0x...' });
 */

import type {
  ArcenCompanyKeys,
  ArcenUserKeys,
  FlagCheckResult,
  ArcenCompany,
  EmbedAccessTokenResponse,
} from '@arcenpay/sdk';

export interface ArcenClientConfig {
  /** Your ArcenPay API key (starts with api_) */
  apiKey: string;
  /** Base URL of your ArcenPay dashboard (default: https://dashboard.arcenpay.xyz) */
  baseUrl?: string;
  /** Request timeout in ms (default: 10_000) */
  timeoutMs?: number;
}

export interface TrackEventInput {
  name: string;
  company: ArcenCompanyKeys;
  user?: ArcenUserKeys;
  traits?: Record<string, unknown>;
}

export interface IdentifyInput {
  company?: ArcenCompanyKeys & { name?: string };
  user?: ArcenUserKeys & { name?: string; email?: string };
  traits?: Record<string, unknown>;
}

export class ArcenClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ArcenClientConfig) {
    if (!config.apiKey.startsWith('api_')) {
      throw new Error('ArcenClient: apiKey must start with "api_"');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://dashboard.arcenpay.xyz').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      companyKeys?: ArcenCompanyKeys;
      userKeys?: ArcenUserKeys;
      query?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

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

  // ─── Events ────────────────────────────────────────────────────────────────

  /** Send a usage tracking event (increments usage counters for flag evaluation) */
  async track(event: TrackEventInput): Promise<void> {
    await this.request('POST', '/api/v1/events', {
      body: {
        event_type: 'track',
        name: event.name,
        company: event.company,
        user: event.user ? {
          id: event.user.id,
          clerk_user_id: event.user.clerkUserId,
          wallet: event.user.wallet,
        } : undefined,
        traits: event.traits,
      },
    });
  }

  /** Identify (create or update) a company and/or user */
  async identify(input: IdentifyInput): Promise<void> {
    await this.request('POST', '/api/v1/events', {
      body: {
        event_type: 'identify',
        company: input.company,
        user: input.user ? {
          id: input.user.id,
          clerk_user_id: input.user.clerkUserId,
          wallet: input.user.wallet,
          name: input.user.name,
          email: input.user.email,
        } : undefined,
        traits: input.traits,
      },
    });
  }

  // ─── Flag Check ─────────────────────────────────────────────────────────────

  /** Check if a feature flag is enabled for a company/user */
  async checkFlag(
    featureKey: string,
    companyKeys: ArcenCompanyKeys,
    userKeys?: ArcenUserKeys,
  ): Promise<FlagCheckResult> {
    const res = await this.request<{ data: FlagCheckResult }>(
      'GET',
      '/api/v1/flags/check',
      { query: { key: featureKey }, companyKeys, userKeys },
    );
    return res.data;
  }

  /** Check multiple flags at once */
  async checkFlags(
    featureKeys: string[],
    companyKeys: ArcenCompanyKeys,
    userKeys?: ArcenUserKeys,
  ): Promise<Record<string, FlagCheckResult>> {
    const results = await Promise.all(
      featureKeys.map((key) => this.checkFlag(key, companyKeys, userKeys)),
    );
    return Object.fromEntries(results.map((r) => [r.flag, r]));
  }

  // ─── Companies ──────────────────────────────────────────────────────────────

  /** List companies (paginated) */
  async listCompanies(options: { limit?: number; search?: string; cursor?: string } = {}): Promise<{
    data: ArcenCompany[];
    count: number;
    nextCursor?: string;
  }> {
    const query: Record<string, string> = {};
    if (options.limit) query.limit = String(options.limit);
    if (options.search) query.search = options.search;
    if (options.cursor) query.cursor = options.cursor;
    return this.request('GET', '/api/v1/companies', { query });
  }

  /** Get a company by ID */
  async getCompany(id: string): Promise<{ data: ArcenCompany & { entitlements: unknown[] } }> {
    return this.request('GET', `/api/v1/companies/${id}`);
  }

  /** Create a new company */
  async createCompany(data: {
    name: string;
    wallet?: string;
    email?: string;
    id?: string;
    traits?: Record<string, unknown>;
  }): Promise<{ data: ArcenCompany }> {
    return this.request('POST', '/api/v1/companies', { body: data });
  }

  /** Update a company */
  async updateCompany(
    id: string,
    data: {
      name?: string;
      traits?: Record<string, unknown>;
      activePlanId?: string | null;
    },
  ): Promise<{ data: ArcenCompany }> {
    return this.request('PATCH', `/api/v1/companies/${id}`, { body: data });
  }

  /** Set a company-level override for a feature flag */
  async setCompanyOverride(
    companyId: string,
    featureKey: string,
    value: boolean,
    reason?: string,
  ): Promise<void> {
    await this.request('POST', `/api/v1/companies/${companyId}/overrides`, {
      body: { featureKey, value, reason },
    });
  }

  // ─── Access Tokens ──────────────────────────────────────────────────────────

  /** Generate a short-lived access token for embedding ArcenEmbed in customer portals */
  async createAccessToken(
    companyKeys?: ArcenCompanyKeys,
    userKeys?: ArcenUserKeys,
    expiresIn = 3600,
  ): Promise<EmbedAccessTokenResponse> {
    const res = await this.request<{ data: EmbedAccessTokenResponse }>(
      'POST',
      '/api/v1/access-tokens',
      {
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
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ArcenApiError';
  }
}
