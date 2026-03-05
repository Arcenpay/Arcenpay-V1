import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { buildSIWEMessage, generateNonce } from "@/lib/auth";
import { POST } from "./route";

vi.mock("viem", () => ({
  verifyMessage: vi.fn(),
}));

import { verifyMessage } from "viem";

const address = "0x1234567890123456789012345678901234567890";
const chainId = 11155111;
const signature =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function buildVerifyRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/auth/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a valid SIWE message once", async () => {
    vi.mocked(verifyMessage).mockResolvedValue(true);

    const nonceRecord = generateNonce();
    const message = buildSIWEMessage({
      address,
      chainId,
      nonce: nonceRecord.nonce,
      domain: "localhost:3000",
      uri: "http://localhost:3000",
      issuedAt: nonceRecord.issuedAt,
    });

    const request = buildVerifyRequest({
      message,
      signature,
      address,
      chainId,
      nonce: nonceRecord.nonce,
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.address).toBe(address);
  });

  it("rejects replayed nonce on second attempt", async () => {
    vi.mocked(verifyMessage).mockResolvedValue(true);

    const nonceRecord = generateNonce();
    const message = buildSIWEMessage({
      address,
      chainId,
      nonce: nonceRecord.nonce,
      domain: "localhost:3000",
      uri: "http://localhost:3000",
      issuedAt: nonceRecord.issuedAt,
    });

    const requestBody = {
      message,
      signature,
      address,
      chainId,
      nonce: nonceRecord.nonce,
    };

    const firstResponse = await POST(buildVerifyRequest(requestBody));
    expect(firstResponse.status).toBe(200);

    const replayResponse = await POST(buildVerifyRequest(requestBody));
    const replayPayload = await replayResponse.json();

    expect(replayResponse.status).toBe(401);
    expect(replayPayload.error).toBe("Invalid or expired nonce");
  });

  it("rejects message tampering even with a valid signature primitive", async () => {
    vi.mocked(verifyMessage).mockResolvedValue(true);

    const nonceRecord = generateNonce();
    const message = buildSIWEMessage({
      address,
      chainId,
      nonce: nonceRecord.nonce,
      domain: "localhost:3000",
      uri: "http://localhost:3000",
      issuedAt: nonceRecord.issuedAt,
    });

    const tamperedMessage = `${message}\nStatement: tampered`;
    const response = await POST(
      buildVerifyRequest({
        message: tamperedMessage,
        signature,
        address,
        chainId,
        nonce: nonceRecord.nonce,
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe("SIWE message mismatch");
  });
});
