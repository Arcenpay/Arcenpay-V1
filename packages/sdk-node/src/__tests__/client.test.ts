import { describe, it, expect, beforeEach, vi } from "vitest";
import { ArcenClient } from "../client";

const BASE_URL = "http://localhost";
const API_KEY = "sk_test_5gcUPXPtLwdoO4afZZwce8HPZiBgpBVgAKKwN8cqe74";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: async () => body,
  } as Response);
}

describe("ArcenClient", () => {
  let client: ArcenClient;

  beforeEach(() => {
    mockFetch.mockClear();
    delete process.env.ARCENPAY_BASE_URL;
    process.env.NODE_ENV = "test";
    client = new ArcenClient({ apiKey: API_KEY, baseUrl: BASE_URL });
  });

  describe("identify()", () => {
    it("calls /api/v1/access-tokens and returns IdentifyResult", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: {
            token: "tok_abc",
            company_id: "co_1",
            user_id: "u_1",
            expires_at: 9999999999,
          },
        }),
      );

      const result = await client.identify({ company: { id: "co_1" } });

      expect(result.token).toBe("tok_abc");
      expect(result.companyId).toBe("co_1");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/access-tokens"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("stores session token internally after identify()", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            data: {
              token: "tok_abc",
              company_id: "co_1",
              expires_at: 9999999999,
            },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            key: "feature",
            enabled: true,
            reason: "rule:plan_pro",
          }),
        );

      await client.identify({ company: { id: "co_1" } });
      await client.checkFlag("feature");

      // Second call should use Bearer tok_abc (not the API key)
      const secondCallHeaders = (mockFetch.mock.calls[1][1] as RequestInit)
        .headers as Record<string, string>;
      expect(secondCallHeaders["Authorization"]).toBe("Bearer tok_abc");
    });
  });

  describe("checkFlag()", () => {
    it("uses /api/v1/check endpoint and returns FlagResult", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ key: "feature", enabled: true, reason: "default" }),
      );

      const result = await client.checkFlag("feature");

      expect(result.enabled).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/check?key=feature"),
        expect.anything(),
      );
    });

    it("defaults to the production API URL when no baseUrl is provided", async () => {
      client = new ArcenClient({ apiKey: API_KEY });
      mockFetch.mockResolvedValueOnce(
        mockResponse({ key: "feature", enabled: true, reason: "default" }),
      );

      await client.checkFlag("feature");

      expect(mockFetch.mock.calls[0]?.[0]).toContain(
        "https://api.arcenpay.com/api/v1/check?key=feature",
      );
    });
  });

  describe("track()", () => {
    it("uses the session token after identify() when no company keys are provided", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            data: {
              token: "tok_abc",
              company_id: "co_internal_1",
              expires_at: 9999999999,
            },
          }),
        )
        .mockResolvedValueOnce(mockResponse({ ok: true }));

      await client.identify({ company: { id: "customer-123" } });
      await client.track("scan");

      const secondCall = mockFetch.mock.calls[1] as [string, RequestInit];
      const headers = secondCall[1].headers as Record<string, string>;

      expect(headers.Authorization).toBe("Bearer tok_abc");
      expect(secondCall[1].body).toBe(
        JSON.stringify({
          event_type: "track",
          name: "scan",
        }),
      );
    });
  });

  describe("checkEntitlement()", () => {
    it("returns EntitlementResult with allocation/usage/exceeded", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          key: "api_calls",
          enabled: true,
          reason: "rule:plan_pro",
          allocation: 1000,
          usage: 247,
          exceeded: false,
        }),
      );

      const result = await client.checkEntitlement("api_calls");

      expect(result.allocation).toBe(1000);
      expect(result.usage).toBe(247);
      expect(result.exceeded).toBe(false);
    });
  });

  describe("listEntitlements()", () => {
    it("returns all entitlements keyed by feature key", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          entitlements: [
            {
              key: "scan",
              enabled: true,
              reason: "Entitled by plan",
              allocation: 100,
              usage: 7,
              exceeded: false,
            },
            {
              key: "ai_summary",
              enabled: false,
              reason: "Not included in the current plan",
              allocation: null,
              usage: 0,
              exceeded: false,
            },
          ],
        }),
      );

      const result = await client.listEntitlements({ id: "customer-123" });

      expect(result.scan.enabled).toBe(true);
      expect(result.ai_summary.enabled).toBe(false);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/entitlements"),
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  describe("consumeEntitlement()", () => {
    it("uses the session token after identify() and returns canonical metered state", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            data: {
              token: "tok_abc",
              company_id: "co_internal_1",
              user_id: "user_1",
              expires_at: 9999999999,
            },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            key: "scan",
            enabled: false,
            reason: "Rule 101 matched · limit reached",
            allocation: 15,
            usage: 15,
            exceeded: true,
            consumed: true,
          }),
        );

      await client.identify({ company: { id: "customer-123" } });
      const result = await client.consumeEntitlement({
        featureKey: "scan",
        traits: { source: "demo" },
        idempotencyKey: "scan-1",
      });

      expect(result.consumed).toBe(true);
      expect(result.exceeded).toBe(true);

      const secondCall = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(secondCall[0]).toContain("/api/v1/usage/consume");
      expect(
        (secondCall[1].headers as Record<string, string>).Authorization,
      ).toBe("Bearer tok_abc");
      expect(secondCall[1].body).toBe(
        JSON.stringify({
          featureKey: "scan",
          traits: { source: "demo" },
          idempotencyKey: "scan-1",
        }),
      );
    });
  });

  describe("activateSubscription()", () => {
    it("calls the activation endpoint with API-key auth and returns the backend result", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: {
            tokenId: "42",
            txHash: "0xabc",
            companyId: "co_1",
            planId: "plan_internal_1",
            paymentAccount: "0x1234567890123456789012345678901234567890",
          },
        }),
      );

      const result = await client.activateSubscription({
        planId: 7n,
        paymentAccount: "0x1234567890123456789012345678901234567890",
        subscriberEmail: "test@example.com",
        company: { id: "customer-123" },
      });

      expect(result.tokenId).toBe("42");
      expect(result.txHash).toBe("0xabc");

      const [url, request] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/v1/subscriptions/activate");
      expect(request.method).toBe("POST");
      expect((request.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${API_KEY}`,
      );
      expect(request.body).toBe(
        JSON.stringify({
          planId: "7",
          paymentAccount: "0x1234567890123456789012345678901234567890",
          company: { id: "customer-123" },
          subscriberEmail: "test@example.com",
        }),
      );
    });
  });

  describe("payment link APIs", () => {
    it("creates a payment link with API-key auth", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          paymentLink: {
            id: "plink_1",
            name: "Priority setup fee",
            slug: "priority-setup-fee-ab12cd34",
            kind: "CUSTOM",
            status: "ACTIVE",
            amount: "49.000000",
            currency: "USDC",
            acceptedToken: "0x0000000000000000000000000000000000000002",
            recipientWallet: "0x1234567890123456789012345678901234567890",
            chainId: 84532,
            checkoutUrl: "http://localhost/pay/priority-setup-fee-ab12cd34",
            metadata: {
              checkoutPage: {
                title: "Priority setup",
                accentColor: "#10b981",
              },
            },
          },
        }),
      );

      const result = await client.createPaymentLink({
        kind: "CUSTOM",
        name: "Priority setup fee",
        amount: 49,
        metadata: {
          checkoutPage: {
            title: "Priority setup",
            accentColor: "#10b981",
          },
        },
        acceptedToken: "0x0000000000000000000000000000000000000002",
        recipientWallet: "0x1234567890123456789012345678901234567890",
      });

      expect(result.paymentLink.id).toBe("plink_1");

      const [url, request] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/v1/payment-links");
      expect(request.method).toBe("POST");
      expect((request.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${API_KEY}`,
      );
      expect(request.body).toBe(
        JSON.stringify({
          kind: "CUSTOM",
          name: "Priority setup fee",
          amount: 49,
          metadata: {
            checkoutPage: {
              title: "Priority setup",
              accentColor: "#10b981",
            },
          },
          acceptedToken: "0x0000000000000000000000000000000000000002",
          recipientWallet: "0x1234567890123456789012345678901234567890",
        }),
      );
    });

    it("resolves acceptedToken symbols and passes through chainId/isAgentic", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          paymentLink: {
            id: "plink_2",
            name: "Agentic data pack",
            slug: "agentic-data-pack-ab12cd34",
            kind: "CUSTOM",
            status: "ACTIVE",
            amount: "15.000000",
            currency: "USDC",
            acceptedToken: "0x3600000000000000000000000000000000000000",
            recipientWallet: "0x1234567890123456789012345678901234567890",
            chainId: 5042002,
            isAgentic: true,
            checkoutUrl: "http://localhost/pay/agentic-data-pack-ab12cd34",
          },
        }),
      );

      await client.createPaymentLink({
        kind: "CUSTOM",
        name: "Agentic data pack",
        amount: 15,
        acceptedToken: "USDC",
        chainId: 5042002,
        recipientWallet: "0x1234567890123456789012345678901234567890",
        isAgentic: true,
      });

      const [url, request] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/v1/payment-links");
      const body = JSON.parse(request.body as string);
      expect(body.acceptedToken).toBe("0x3600000000000000000000000000000000000000");
      expect(body.chainId).toBe(5042002);
      expect(body.isAgentic).toBe(true);
    });

    it("lists payment links with API-key auth", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          paymentLinks: [
            {
              id: "plink_1",
              name: "Setup fee",
              slug: "setup-fee-ab12cd34",
              kind: "CUSTOM",
              status: "ACTIVE",
              amount: "49.000000",
              currency: "USDC",
              acceptedToken: "0x0000000000000000000000000000000000000002",
              recipientWallet: "0x1234567890123456789012345678901234567890",
              chainId: 84532,
              checkoutUrl: "http://localhost/pay/setup-fee-ab12cd34",
            },
          ],
        }),
      );

      const result = await client.listPaymentLinks();

      expect(result.paymentLinks).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/payment-links"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("creates a checkout session from a payment link", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          checkoutSession: {
            id: "sess_1",
            purpose: "CUSTOM",
            status: "PENDING",
            amount: "49.000000",
            currency: "USDC",
            paymentLink: {
              id: "plink_1",
              name: "Setup fee",
              slug: "setup-fee-ab12cd34",
              kind: "CUSTOM",
            },
          },
        }),
      );

      const result = await client.createCheckoutSession({
        paymentLinkId: "plink_1",
        customerEmail: "buyer@example.com",
        customerName: "Ada Lovelace",
      });

      expect(result.checkoutSession.id).toBe("sess_1");

      const [url, request] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/v1/checkout-sessions");
      expect(request.method).toBe("POST");
      expect(request.body).toBe(
        JSON.stringify({
          paymentLinkId: "plink_1",
          customerEmail: "buyer@example.com",
          customerName: "Ada Lovelace",
        }),
      );
    });
  });
});
