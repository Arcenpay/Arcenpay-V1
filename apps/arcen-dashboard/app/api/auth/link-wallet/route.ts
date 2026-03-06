// ============================================================
//  Dashboard API — Link Wallet to Email Account
//  POST /api/auth/link-wallet
//
//  Must be called with an active magic-link session.
//  Accepts a SIWE proof and associates the wallet with the DB user,
//  then re-issues the session JWT with the wallet address included.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { z } from "zod";
import { getSession } from "@/lib/auth.server";
import { db } from "@/lib/db";
import {
  buildSIWEMessage,
  createEmailSession,
  COOKIE_NAME,
} from "@/lib/auth";
import { consumeNonce } from "@/lib/nonce.server";

const Schema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.number().int().positive(),
  nonce: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();

    if (!session || session.authMethod !== "magic") {
      return NextResponse.json(
        { error: "Requires magic-link session" },
        { status: 401 },
      );
    }

    const body = await req.json();
    const parsed = Schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { message, signature, address, chainId, nonce } = parsed.data;

    // Validate nonce (DB-backed, one-time use)
    const nonceRecord = await consumeNonce(nonce);
    if (!nonceRecord) {
      return NextResponse.json(
        { error: "Invalid or expired nonce" },
        { status: 401 },
      );
    }

    const host = req.headers.get("host") || "arcenpay.xyz";
    const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
    const proto =
      req.headers.get("x-forwarded-proto") || (isLocal ? "http" : "https");
    const domain = host;
    const uri = `${proto}://${host}`;

    const expectedMessage = buildSIWEMessage({
      address,
      chainId,
      nonce,
      domain,
      uri,
      issuedAt: nonceRecord.issuedAt,
    });

    if (message !== expectedMessage) {
      return NextResponse.json(
        { error: "SIWE message mismatch" },
        { status: 401 },
      );
    }

    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message: expectedMessage,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Check the wallet isn't already claimed by another account
    const existingWallet = await db.user.findUnique({
      where: { walletAddress: address },
    });
    if (existingWallet && existingWallet.id !== session.userId) {
      return NextResponse.json(
        { error: "This wallet is already linked to a different account" },
        { status: 409 },
      );
    }

    // Link the wallet
    await db.user.update({
      where: { id: session.userId },
      data: { walletAddress: address },
    });

    // Re-issue the JWT with the wallet address included
    const jwt = await createEmailSession(session.userId, session.email, {
      linkedWallet: address,
      teamId: session.teamId,
      teamRole: session.teamRole,
    });

    const response = NextResponse.json({ ok: true, address });
    response.cookies.set(COOKIE_NAME, jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error("[api/auth/link-wallet]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
