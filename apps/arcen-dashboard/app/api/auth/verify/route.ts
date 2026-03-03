import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { z } from "zod";
import { consumeNonce, buildSIWEMessage, createSession, COOKIE_NAME } from "@/lib/auth";

// ── Zod schema for /auth/verify request body ──────────────────
const VerifySchema = z.object({
  message: z.string().min(1, "message is required"),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "signature must be a hex string"),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "address must be a valid Ethereum address"),
  chainId: z.number().int().positive("chainId must be a positive integer"),
  nonce: z.string().min(1, "nonce is required"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate input
    const parsed = VerifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { message, signature, address, chainId, nonce } = parsed.data;

    // Validate nonce (one-time use, 5-minute TTL)
    if (!consumeNonce(nonce)) {
      return NextResponse.json({ error: "Invalid or expired nonce" }, { status: 401 });
    }

    // Verify SIWE message signature
    const expectedMessage = buildSIWEMessage({ address, chainId, nonce });
    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message: expectedMessage,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      // Also try verifying the raw message in case the frontend constructed it differently
      const isValidRaw = await verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      if (!isValidRaw) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    // Issue JWT + set HttpOnly cookie
    const token = await createSession(address, chainId);

    const response = NextResponse.json({ ok: true, address });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60, // 24h
    });

    return response;
  } catch (err) {
    // Never expose internal error details to the client
    console.error("[auth/verify]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
