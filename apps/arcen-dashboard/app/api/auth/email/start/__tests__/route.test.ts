import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import {
  getActiveTeamInvitationByToken,
  getLatestActiveEmailCode,
  issueEmailAuthCode,
} from "@/lib/auth-flow";

vi.mock("@/lib/arcjet", async () => {
  const actual = await vi.importActual<typeof import("@/lib/arcjet")>("@/lib/arcjet");
  return {
    ...actual,
    authEmailStartProtect: {
      protect: vi.fn(),
    },
  };
});

vi.mock("@/lib/auth-flow", () => ({
  EMAIL_AUTH_PURPOSE_LOGIN: "login",
  EMAIL_AUTH_RESEND_COOLDOWN_MS: 30_000,
  getLatestActiveEmailCode: vi.fn(),
  getActiveTeamInvitationByToken: vi.fn(),
  issueEmailAuthCode: vi.fn(),
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
}));

const mockGetLatestActiveEmailCode = vi.mocked(getLatestActiveEmailCode);
const mockGetActiveTeamInvitationByToken = vi.mocked(getActiveTeamInvitationByToken);
const mockIssueEmailAuthCode = vi.mocked(issueEmailAuthCode);

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
  let mockProtect: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
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

    const { authEmailStartProtect } = await import("@/lib/arcjet");
    mockProtect = vi.mocked(authEmailStartProtect.protect);
    mockProtect.mockResolvedValue({
      isDenied: () => false,
      isAllowed: () => true,
      reason: { isRateLimit: () => false, isBot: () => false },
    });
  });

  it("returns a resend cooldown response", async () => {
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
  });

  it("returns 429 when Arcjet denies the request", async () => {
    mockProtect.mockResolvedValue({
      isDenied: () => true,
      isAllowed: () => false,
      reason: { isRateLimit: () => true, isBot: () => false },
    });

    const response = await POST(makeRequest({ email: "teammate@example.com" }));
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.error).toBe("Too many verification attempts. Please wait and try again.");
    expect(mockIssueEmailAuthCode).not.toHaveBeenCalled();
  });

  it("returns 403 when Arcjet detects a bot", async () => {
    mockProtect.mockResolvedValue({
      isDenied: () => true,
      isAllowed: () => false,
      reason: { isRateLimit: () => false, isBot: () => true },
    });

    const response = await POST(makeRequest({ email: "teammate@example.com" }));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe("Forbidden");
  });
});
