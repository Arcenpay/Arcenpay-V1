import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArcenClient } from '../client';

const BASE_URL = 'http://localhost';
const API_KEY = 'api_testkey123';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: async () => body,
  } as Response);
}

describe('ArcenClient', () => {
  let client: ArcenClient;

  beforeEach(() => {
    mockFetch.mockClear();
    client = new ArcenClient({ apiKey: API_KEY, baseUrl: BASE_URL });
  });

  describe('identify()', () => {
    it('calls /api/v1/access-tokens and returns IdentifyResult', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        data: { token: 'tok_abc', company_id: 'co_1', user_id: 'u_1', expires_at: 9999999999 },
      }));

      const result = await client.identify({ company: { id: 'co_1' } });

      expect(result.token).toBe('tok_abc');
      expect(result.companyId).toBe('co_1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/access-tokens'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('stores session token internally after identify()', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({
          data: { token: 'tok_abc', company_id: 'co_1', expires_at: 9999999999 },
        }))
        .mockResolvedValueOnce(mockResponse({
          key: 'feature', enabled: true, reason: 'rule:plan_pro',
        }));

      await client.identify({ company: { id: 'co_1' } });
      await client.checkFlag('feature');

      // Second call should use Bearer tok_abc (not the API key)
      const secondCallHeaders = (mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
      expect(secondCallHeaders['Authorization']).toBe('Bearer tok_abc');
    });
  });

  describe('checkFlag()', () => {
    it('uses /api/v1/check endpoint and returns FlagResult', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ key: 'feature', enabled: true, reason: 'default' }));

      const result = await client.checkFlag('feature');

      expect(result.enabled).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/check?key=feature'),
        expect.anything(),
      );
    });
  });

  describe('track()', () => {
    it('uses the session token after identify() when no company keys are provided', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({
          data: { token: 'tok_abc', company_id: 'co_internal_1', expires_at: 9999999999 },
        }))
        .mockResolvedValueOnce(mockResponse({ ok: true }));

      await client.identify({ company: { id: 'customer-123' } });
      await client.track('scan');

      const secondCall = mockFetch.mock.calls[1] as [string, RequestInit];
      const headers = secondCall[1].headers as Record<string, string>;

      expect(headers.Authorization).toBe('Bearer tok_abc');
      expect(secondCall[1].body).toBe(
        JSON.stringify({
          event_type: 'track',
          name: 'scan',
        }),
      );
    });
  });

  describe('checkEntitlement()', () => {
    it('returns EntitlementResult with allocation/usage/exceeded', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        key: 'api_calls', enabled: true, reason: 'rule:plan_pro',
        allocation: 1000, usage: 247, exceeded: false,
      }));

      const result = await client.checkEntitlement('api_calls');

      expect(result.allocation).toBe(1000);
      expect(result.usage).toBe(247);
      expect(result.exceeded).toBe(false);
    });
  });

  describe('consumeEntitlement()', () => {
    it('uses the session token after identify() and returns canonical metered state', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            data: {
              token: 'tok_abc',
              company_id: 'co_internal_1',
              user_id: 'user_1',
              expires_at: 9999999999,
            },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            key: 'scan',
            enabled: false,
            reason: 'Rule 101 matched · limit reached',
            allocation: 15,
            usage: 15,
            exceeded: true,
            consumed: true,
          }),
        );

      await client.identify({ company: { id: 'customer-123' } });
      const result = await client.consumeEntitlement({
        featureKey: 'scan',
        traits: { source: 'demo' },
        idempotencyKey: 'scan-1',
      });

      expect(result.consumed).toBe(true);
      expect(result.exceeded).toBe(true);

      const secondCall = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(secondCall[0]).toContain('/api/v1/usage/consume');
      expect((secondCall[1].headers as Record<string, string>).Authorization).toBe(
        'Bearer tok_abc',
      );
      expect(secondCall[1].body).toBe(
        JSON.stringify({
          featureKey: 'scan',
          traits: { source: 'demo' },
          idempotencyKey: 'scan-1',
        }),
      );
    });
  });

  describe('activateSubscription()', () => {
    it('calls the activation endpoint with API-key auth and returns the backend result', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: {
            tokenId: '42',
            txHash: '0xabc',
            companyId: 'co_1',
            planId: 'plan_internal_1',
            paymentAccount: '0x1234567890123456789012345678901234567890',
          },
        }),
      );

      const result = await client.activateSubscription({
        planId: 7n,
        paymentAccount: '0x1234567890123456789012345678901234567890',
        subscriberEmail: 'test@example.com',
        company: { id: 'customer-123' },
      });

      expect(result.tokenId).toBe('42');
      expect(result.txHash).toBe('0xabc');

      const [url, request] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/v1/subscriptions/activate');
      expect(request.method).toBe('POST');
      expect((request.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${API_KEY}`,
      );
      expect(request.body).toBe(
        JSON.stringify({
          planId: '7',
          paymentAccount: '0x1234567890123456789012345678901234567890',
          company: { id: 'customer-123' },
          subscriberEmail: 'test@example.com',
        }),
      );
    });
  });
});
