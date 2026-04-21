import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { issueEmailAuthCode } from "./auth-flow";
import { db } from "@/lib/db";
import { isEmailDeliveryConfigured, sendEmailAuthCode } from "@/lib/email";

vi.mock("@/lib/auth.server", () => ({
  hashOpaqueToken: (value: string) => `hashed:${value}`,
}));

vi.mock("@/lib/email", () => ({
  isEmailDeliveryConfigured: vi.fn(),
  sendEmailAuthCode: vi.fn(),
  sendTeamInviteEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    emailAuthCode: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: "email_code_1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };

  return {
    db: {
      emailAuthCode: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn(async (arg: unknown) => {
        if (typeof arg === "function") {
          return arg(tx);
        }
        return arg;
      }),
    },
  };
});

const mockIsEmailDeliveryConfigured = vi.mocked(isEmailDeliveryConfigured);
const mockSendEmailAuthCode = vi.mocked(sendEmailAuthCode);

describe("issueEmailAuthCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    mockIsEmailDeliveryConfigured.mockReturnValue(false);
    mockSendEmailAuthCode.mockResolvedValue();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps local auth working when email delivery is not configured in development", async () => {
    const result = await issueEmailAuthCode({
      email: "Teammate@Example.com",
    });

    expect(result.code).toHaveLength(6);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(db.emailAuthCode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: "teammate@example.com",
        }),
      }),
    );
    expect(mockSendEmailAuthCode).not.toHaveBeenCalled();
  });
});
