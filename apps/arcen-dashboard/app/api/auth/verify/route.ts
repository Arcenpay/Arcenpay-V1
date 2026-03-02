import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { consumeNonce, buildSIWEMessage, createSession, COOKIE_NAME } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { message, signature, address, chainId, nonce } = await req.json();

    if (!message || !signature || !address || !chainId || !nonce) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

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
      // Also try verifying the raw message in case the frontend constructed it
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
    console.error("[auth/verify]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
