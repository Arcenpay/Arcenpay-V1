import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import {
  getActiveTeamInvitationByToken,
  getLatestActiveEmailCode,
  issueEmailAuthCode,
} from "@/lib/auth-flow";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/auth-flow", () => ({
  EMAIL_AUTH_PURPOSE_LOGIN: "login",
  EMAIL_AUTH_RESEND_COOLDOWN_MS: 30_000,
  getLatestActiveEmailCode: vi.fn(),
  getActiveTeamInvitationByToken: vi.fn(),
  issueEmailAuthCode: vi.fn(),
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({
    ok: true,
    remaining: 4,
    resetAt: new Date("2026-04-21T10:10:00.000Z").getTime(),
  })),
  applyRateLimitHeaders: vi.fn(),
}));

const mockGetLatestActiveEmailCode = vi.mocked(getLatestActiveEmailCode);
const mockGetActiveTeamInvitationByToken = vi.mocked(getActiveTeamInvitationByToken);
const mockIssueEmailAuthCode = vi.mocked(issueEmailAuthCode);
const mockRateLimit = vi.mocked(rateLimit);
const mockApplyRateLimitHeaders = vi.mocked(applyRateLimitHeaders);

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/email/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/email/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:00:00.000Z"));
    mockGetLatestActiveEmailCode.mockResolvedValue(null);
    mockGetActiveTeamInvitationByToken.mockResolvedValue(null);
    mockIssueEmailAuthCode.mockResolvedValue({
      code: "123456",
      expiresAt: new Date("2026-04-21T10:10:00.000Z"),
      retryAt: new Date("2026-04-21T10:00:30.000Z"),
    });
    mockRateLimit.mockReturnValue({
      ok: true,
      remaining: 4,
      resetAt: new Date("2026-04-21T10:10:00.000Z").getTime(),
    });
  });

  it("returns a resend cooldown response before incrementing the broader limiter", async () => {
    mockGetLatestActiveEmailCode.mockResolvedValue({
      createdAt: new Date("2026-04-21T09:59:45.000Z"),
    } as Awaited<ReturnType<typeof getLatestActiveEmailCode>>);

    const response = await POST(
      makeRequest({ email: "Teammate@Example.com" }),
    );
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.retryAt).toBe("2026-04-21T10:00:15.000Z");
    expect(response.headers.get("retry-after")).toBe("15");
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockIssueEmailAuthCode).not.toHaveBeenCalled();
  });

  it("returns retryAt when the broader limit is exceeded", async () => {
    mockRateLimit
      .mockReturnValueOnce({
        ok: false,
        remaining: 0,
        resetAt: new Date("2026-04-21T10:05:00.000Z").getTime(),
      })
      .mockReturnValueOnce({
        ok: true,
        remaining: 4,
        resetAt: new Date("2026-04-21T10:05:00.000Z").getTime(),
      });

    const response = await POST(makeRequest({ email: "teammate@example.com" }));
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.retryAt).toBe("2026-04-21T10:05:00.000Z");
    expect(response.headers.get("retry-after")).toBe("300");
    expect(mockApplyRateLimitHeaders).toHaveBeenCalled();
    expect(mockIssueEmailAuthCode).not.toHaveBeenCalled();
  });
});
