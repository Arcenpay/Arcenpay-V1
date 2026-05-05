// ============================================================
//  Dashboard API — Link Wallet to authenticated account
//  POST /api/auth/link-wallet
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildSIWEMessage } from "@/lib/auth";
import { consumeNonce } from "@/lib/nonce.server";
import { getSession } from "@/lib/auth.server";
import { maskEmail } from "@/lib/auth-flow";
import { BASE_SEPOLIA_CHAIN_ID, getChainLabel } from "@/lib/default-chain";

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
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const normalizedAddress = address.toLowerCase();

    if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
      return NextResponse.json(
        {
          error: `Only ${getChainLabel(BASE_SEPOLIA_CHAIN_ID)} is supported right now`,
        },
        { status: 400 },
      );
    }

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
    const expectedMessage = buildSIWEMessage({
      address,
      chainId,
      nonce,
      domain: host,
      uri: `${proto}://${host}`,
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

    const walletOwner = await db.user.findUnique({
      where: { walletAddress: normalizedAddress },
      select: { id: true, email: true },
    });

    if (walletOwner && walletOwner.id !== session.userId) {
      return NextResponse.json(
        {
          error: "This wallet is already linked to another account",
          maskedOwnerEmail: maskEmail(walletOwner.email ?? ""),
        },
        { status: 409 },
      );
    }

    await db.user.update({
      where: { id: session.userId },
      data: {
        walletAddress: normalizedAddress,
      },
    });

    return NextResponse.json({ ok: true, address: normalizedAddress });
  } catch (err) {
    console.error("[api/auth/link-wallet]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
