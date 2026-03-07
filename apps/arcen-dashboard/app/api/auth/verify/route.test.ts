import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { buildSIWEMessage, generateNonce } from "@/lib/auth";
import { POST } from "./route";

vi.mock("viem", () => ({
  verifyMessage: vi.fn(),
}));
vi.mock("@/lib/nonce.server", () => ({
  consumeNonce: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    teamMember: {
      findFirst: vi.fn(),
    },
    team: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { verifyMessage } from "viem";
import { consumeNonce } from "@/lib/nonce.server";
import { db } from "@/lib/db";

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
  const nonceStore = new Map<string, string>();
  const baseDate = new Date("2026-01-01T00:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    nonceStore.clear();

    vi.mocked(consumeNonce).mockImplementation(async (nonce: string) => {
      const issuedAt = nonceStore.get(nonce);
      if (!issuedAt) return null;
      nonceStore.delete(nonce);
      return { issuedAt };
    });

    vi.mocked(db.user.upsert).mockResolvedValue({
      id: "user_1",
      walletAddress: address,
      email: null,
      emailVerified: false,
      currentTeamId: null,
      createdAt: baseDate,
      updatedAt: baseDate,
    });
    vi.mocked(db.user.update).mockResolvedValue({
      id: "user_1",
      walletAddress: address,
      email: null,
      emailVerified: false,
      currentTeamId: "team_1",
      createdAt: baseDate,
      updatedAt: baseDate,
    });
    vi.mocked(db.teamMember.findFirst).mockResolvedValue(null);
    vi.mocked(db.team.findUnique).mockResolvedValue(null);
    vi.mocked(db.team.create).mockResolvedValue({
      id: "team_1",
      name: "My Workspace",
      slug: "my-workspace",
      environmentMode: "DEVELOPMENT",
      invoicePrefix: null,
      createdAt: baseDate,
      updatedAt: baseDate,
    });
  });

  it("accepts a valid SIWE message once", async () => {
    vi.mocked(verifyMessage).mockResolvedValue(true);

    const nonceRecord = generateNonce();
    nonceStore.set(nonceRecord.nonce, nonceRecord.issuedAt);
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
    nonceStore.set(nonceRecord.nonce, nonceRecord.issuedAt);
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
    nonceStore.set(nonceRecord.nonce, nonceRecord.issuedAt);
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
